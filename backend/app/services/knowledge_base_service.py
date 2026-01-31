"""
Knowledge Base Service for Dungloe GAA Analytics.

Loads and indexes documents from the Knowledge base folder:
- GAA rules and regulations
- STATSports GPS/fitness data
- Tactical guides and training materials

Provides proactive context for ALL AI analysis, not just Q&A.
Uses Claude Vision to extract data from image-based PDFs (like STATSports reports).
"""

import os
import re
import logging
import base64
import json
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger(__name__)

# Try to import pymupdf, fallback gracefully if not installed
try:
    import fitz  # pymupdf
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    logger.warning("pymupdf not installed - PDF loading will be disabled")

# Try to import anthropic for vision
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("anthropic not installed - Vision extraction will be disabled")


@dataclass
class Document:
    """A loaded knowledge base document."""
    filename: str
    doc_type: str  # 'rules', 'statsports', 'tactics', 'other'
    content: str
    metadata: dict = field(default_factory=dict)
    loaded_at: datetime = field(default_factory=datetime.now)


class KnowledgeBaseService:
    """
    Service for loading and querying the knowledge base.

    The knowledge base provides context for ALL AI analysis:
    - Live match insights (e.g., fatigue detection from GPS benchmarks)
    - Chart analysis (e.g., compare stats to league averages)
    - Post-match reports (e.g., tactical rule interpretations)
    """

    # Manually curated STATSports data (extracted from image-based PDFs)
    # This is used when PDFs don't have extractable text
    STATSPORTS_DATA = {
        "Game_Snr Div 2 League Final_V Ballyshannon_190725.pdf": {
            "match": "Dungloe Senior Men vs Ballyshannon - Div 2 League Final",
            "date": "2025-07-19",
            "team_averages": {
                "total_distance_m": 10320,
                "max_speed_ms": 8.97,
                "high_speed_running_m": 791,
                "hml_distance_m": 1779,
                "sprints": 43,
                "accelerations": 50.53,
                "decelerations": 50.29,
                "dynamic_stress_load": 354.7
            },
            "players": [
                {"name": "Dylan S", "position": "GK"},
                {"name": "Barry C", "position": "DEF"},
                {"name": "Matthew", "position": "DEF"},
                {"name": "Ryan C", "position": "DEF"},
                {"name": "Darren C", "position": "DEF"},
                {"name": "Shaun M", "position": "MID"},
                {"name": "Oisin B", "position": "MID"},
                {"name": "Conor O'D", "position": "MID"},
                {"name": "Daire G", "position": "FWD"},
                {"name": "Ryan G", "position": "FWD"},
                {"name": "Jason McB", "position": "FWD"},
                {"name": "Noel McB", "position": "FWD"},
                {"name": "Dan W", "position": "SUB"},
                {"name": "Conor G", "position": "SUB"},
                {"name": "Cianan M", "position": "SUB"},
                {"name": "Patrick O'D", "position": "SUB"},
                {"name": "Conor D", "position": "SUB"}
            ],
            "benchmarks": """
## GPS Performance Benchmarks (League Final vs Ballyshannon)

### Team Averages
- Total Distance: 10,320m (typical senior match: 8,000-12,000m)
- Max Speed: 8.97 m/s (~32.3 km/h) - indicates good sprint capacity
- High Speed Running: 791m (running above 5.5 m/s)
- HML Distance: 1,779m (high metabolic load distance)
- Sprints: 43 per player average
- Accelerations: 50.53 average
- Decelerations: 50.29 average
- Dynamic Stress Load: 354.7 (physical strain indicator)

### What These Metrics Mean
- **Total Distance**: Overall workload indicator. >10km shows high intensity match
- **Max Speed**: Sprint capability. 8-9 m/s is good club level
- **High Speed Running**: Amount of time at high intensity
- **Sprints**: Number of explosive efforts (>7 m/s for >1 second)
- **Dynamic Stress Load**: Combines accelerations, decelerations, changes of direction

### Fatigue Indicators to Watch
- Distance in last 15 mins drops >20% from first 15 mins
- Sprint frequency dropping significantly in second half
- Reduced max speed readings in second half
- Increased deceleration-to-acceleration ratio (suggests reactive play)

### Position Benchmarks
- Midfielders typically: 11,000-13,000m total distance
- Half forwards: 9,000-11,000m
- Full forwards: 7,000-9,000m (more explosive, less total distance)
- Defenders: 9,000-11,000m
- Goalkeeper: 4,000-6,000m
"""
        }
    }

    def __init__(self, knowledge_base_path: Optional[str] = None):
        """Initialize the knowledge base service."""
        # Default to Knowledge base folder relative to project root
        if knowledge_base_path is None:
            # Navigate from backend/app/services to project root
            project_root = Path(__file__).parent.parent.parent.parent
            knowledge_base_path = project_root / "Knowledge base"

        self.kb_path = Path(knowledge_base_path)
        self.documents: dict[str, Document] = {}
        self._loaded = False
        self._vision_cache_path = self.kb_path / ".vision_cache"

        # Create cache directory for vision extractions
        if self.kb_path.exists():
            self._vision_cache_path.mkdir(exist_ok=True)

        logger.info(f"Knowledge base path: {self.kb_path}")

    def load_documents(self) -> None:
        """Load all documents from the knowledge base folder."""
        if not self.kb_path.exists():
            logger.warning(f"Knowledge base folder not found: {self.kb_path}")
            return

        if not PYMUPDF_AVAILABLE:
            logger.warning("Cannot load PDFs - pymupdf not installed")
            return

        for file_path in self.kb_path.glob("*.pdf"):
            try:
                self._load_pdf(file_path)
            except Exception as e:
                logger.error(f"Failed to load {file_path.name}: {e}")

        self._loaded = True
        logger.info(f"Loaded {len(self.documents)} documents from knowledge base")

    def _extract_with_vision(self, file_path: Path) -> Optional[str]:
        """
        Use Claude Vision to extract text/data from image-based PDFs.

        Converts PDF pages to images and sends to Claude for extraction.
        Results are cached to avoid repeated API calls.
        """
        if not ANTHROPIC_AVAILABLE:
            logger.warning("Cannot use vision extraction - anthropic not installed")
            return None

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            logger.warning("Cannot use vision extraction - ANTHROPIC_API_KEY not set")
            return None

        # Check cache first
        cache_file = self._vision_cache_path / f"{file_path.stem}.txt"
        if cache_file.exists():
            logger.info(f"Using cached vision extraction for {file_path.name}")
            return cache_file.read_text(encoding='utf-8')

        logger.info(f"Extracting {file_path.name} with Claude Vision...")

        try:
            # Open PDF and convert pages to images
            pdf = fitz.open(file_path)
            images_base64 = []

            # Convert each page to an image (limit to first 5 pages for cost)
            for page_num in range(min(len(pdf), 5)):
                page = pdf[page_num]
                # Render at 150 DPI for good quality without huge size
                mat = fitz.Matrix(150/72, 150/72)
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                images_base64.append({
                    "page": page_num + 1,
                    "data": img_base64
                })

            pdf.close()

            if not images_base64:
                return None

            # Build message content with images
            content = []
            for img in images_base64:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": img["data"]
                    }
                })

            content.append({
                "type": "text",
                "text": """Extract ALL data from this STATSports GPS performance report.

Please extract:
1. Match/session details (date, opponent, competition)
2. ALL player names and their individual statistics
3. Team averages for each metric
4. Any charts or graphs - describe the data they show

Format the output as structured text that can be used for analysis. Include:
- Player name
- Total Distance (m)
- Max Speed (m/s)
- High Speed Running distance
- Number of Sprints
- Accelerations
- Decelerations
- Any other metrics shown

Be thorough - extract every number and metric you can see."""
            })

            # Call Claude Vision
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                messages=[{
                    "role": "user",
                    "content": content
                }]
            )

            extracted_text = response.content[0].text

            # Cache the result
            cache_file.write_text(extracted_text, encoding='utf-8')
            logger.info(f"Vision extraction complete for {file_path.name}: {len(extracted_text)} chars")

            return extracted_text

        except anthropic.AuthenticationError:
            logger.error("Claude API authentication failed - check your API key")
            return None
        except Exception as e:
            logger.error(f"Vision extraction failed for {file_path.name}: {e}")
            return None

    def _load_pdf(self, file_path: Path) -> None:
        """Load a PDF file and extract its content."""
        filename = file_path.name
        doc_type = self._classify_document(filename)

        # Open PDF with pymupdf
        pdf = fitz.open(file_path)

        # Extract text from all pages
        content_parts = []
        for page_num, page in enumerate(pdf):
            text = page.get_text()
            if text.strip():
                content_parts.append(f"[Page {page_num + 1}]\n{text}")

        content = "\n\n".join(content_parts)
        pdf.close()

        # If no text extracted (image-based PDF), try Claude Vision
        if not content.strip():
            logger.info(f"No text in {filename}, attempting Claude Vision extraction...")

            # Try Claude Vision first
            vision_content = self._extract_with_vision(file_path)
            if vision_content:
                content = f"# {filename}\n## Extracted via Claude Vision\n\n{vision_content}"
                logger.info(f"Successfully extracted {filename} with Claude Vision")
            # Fall back to manual data if vision fails
            elif filename in self.STATSPORTS_DATA:
                manual_data = self.STATSPORTS_DATA[filename]
                content = f"""
# {manual_data['match']}
Date: {manual_data['date']}

## Team Performance Metrics
{manual_data['benchmarks']}

## Team Averages (Raw Data)
- Total Distance: {manual_data['team_averages']['total_distance_m']}m
- Max Speed: {manual_data['team_averages']['max_speed_ms']} m/s
- High Speed Running: {manual_data['team_averages']['high_speed_running_m']}m
- Sprints: {manual_data['team_averages']['sprints']}
- Accelerations: {manual_data['team_averages']['accelerations']}
- Decelerations: {manual_data['team_averages']['decelerations']}
- Dynamic Stress Load: {manual_data['team_averages']['dynamic_stress_load']}

## Players
{chr(10).join(f"- {p['name']} ({p['position']})" for p in manual_data['players'])}
"""
                logger.info(f"Using manual fallback data for: {filename}")
            else:
                logger.warning(f"Could not extract content from {filename}")

        # Extract metadata based on doc type
        metadata = self._extract_metadata(filename, content, doc_type)

        self.documents[filename] = Document(
            filename=filename,
            doc_type=doc_type,
            content=content,
            metadata=metadata
        )

        logger.info(f"Loaded {filename} ({doc_type}): {len(content)} chars")

    def _classify_document(self, filename: str) -> str:
        """Classify document type based on filename."""
        filename_lower = filename.lower()

        if 'rules' in filename_lower or 'regulation' in filename_lower:
            return 'rules'
        elif 'game_' in filename_lower or 'statsports' in filename_lower:
            return 'statsports'
        elif 'tactic' in filename_lower or 'formation' in filename_lower:
            return 'tactics'
        else:
            return 'other'

    def _extract_metadata(self, filename: str, content: str, doc_type: str) -> dict:
        """Extract relevant metadata from document content."""
        metadata = {'filename': filename, 'doc_type': doc_type}

        if doc_type == 'statsports':
            # Try to extract match info from filename
            # Format: Game_Snr Div 2 League Final_V Ballyshannon_190725.pdf
            match = re.search(r'_V\s+(\w+)_(\d{6})', filename)
            if match:
                metadata['opponent'] = match.group(1)
                date_str = match.group(2)
                # Parse DDMMYY format
                try:
                    metadata['match_date'] = f"20{date_str[4:6]}-{date_str[2:4]}-{date_str[0:2]}"
                except:
                    pass

            # Extract player stats summary if present
            if 'Total Distance' in content:
                metadata['has_distance_data'] = True
            if 'Max Speed' in content:
                metadata['has_speed_data'] = True
            if 'Sprint' in content:
                metadata['has_sprint_data'] = True

        return metadata

    def get_context_for_live_match(self, current_stats: dict = None) -> str:
        """
        Get relevant knowledge base context for LIVE match analysis.

        This is called PROACTIVELY during match recording to inform insights.
        Includes:
        - GPS benchmarks for fatigue detection
        - Tactical principles for pattern recognition
        - Rule clarifications for event interpretation
        """
        if not self._loaded:
            self.load_documents()

        context_parts = []

        # Include STATSports benchmarks for comparison
        for doc in self.documents.values():
            if doc.doc_type == 'statsports':
                # Extract key metrics as benchmarks
                benchmarks = self._extract_statsports_benchmarks(doc.content)
                if benchmarks:
                    context_parts.append(f"""
## GPS Performance Benchmarks (from {doc.metadata.get('opponent', 'previous')} match)
{benchmarks}
Use these benchmarks to:
- Detect player fatigue (compare current activity to typical levels)
- Identify workload imbalances
- Suggest substitution timing
""")

        # Include relevant tactical principles
        for doc in self.documents.values():
            if doc.doc_type == 'tactics':
                context_parts.append(f"""
## Tactical Reference
{doc.content[:2000]}...
""")

        # Include key rules for match events
        for doc in self.documents.values():
            if doc.doc_type == 'rules':
                rules_excerpt = self._extract_relevant_rules(doc.content)
                if rules_excerpt:
                    context_parts.append(f"""
## GAA Rules Reference
{rules_excerpt}
""")

        return "\n".join(context_parts)

    def get_context_for_analytics(self, season_data: dict = None) -> str:
        """
        Get knowledge base context for analytics/chart generation.

        This informs the LLM when it's deciding what charts to show
        and how to interpret the season data.
        """
        if not self._loaded:
            self.load_documents()

        context_parts = []

        # Include GPS data for physical performance context
        for doc in self.documents.values():
            if doc.doc_type == 'statsports':
                context_parts.append(f"""
## Physical Performance Data ({doc.metadata.get('opponent', 'Match')} - {doc.metadata.get('match_date', 'Unknown date')})
{self._summarize_statsports(doc.content)}

Consider this when analyzing:
- Are players maintaining fitness levels across the season?
- How does workload correlate with performance?
- Which physical metrics predict good match outcomes?
""")

        # Include rule context for scoring analysis
        for doc in self.documents.values():
            if doc.doc_type == 'rules':
                scoring_rules = self._extract_scoring_rules(doc.content)
                if scoring_rules:
                    context_parts.append(f"""
## Scoring Rules Context
{scoring_rules}
""")

        return "\n".join(context_parts)

    def get_context_for_post_match(self, match_id: str = None) -> str:
        """
        Get knowledge base context for post-match analysis.

        Comprehensive context for detailed match reports.
        """
        if not self._loaded:
            self.load_documents()

        # For post-match, include fuller context
        context_parts = []

        for doc in self.documents.values():
            if doc.doc_type == 'statsports':
                context_parts.append(f"""
## Historical GPS Data - {doc.metadata.get('opponent', 'Previous Match')}
{doc.content[:3000]}
""")
            elif doc.doc_type == 'rules':
                context_parts.append(f"""
## GAA Rules Reference
{doc.content[:2000]}
""")
            elif doc.doc_type == 'tactics':
                context_parts.append(f"""
## Tactical Reference
{doc.content[:2000]}
""")

        return "\n".join(context_parts)

    def get_full_context(self) -> str:
        """Get all knowledge base content (for comprehensive analysis)."""
        if not self._loaded:
            self.load_documents()

        parts = []
        for doc in self.documents.values():
            parts.append(f"""
{'='*60}
Document: {doc.filename}
Type: {doc.doc_type}
{'='*60}
{doc.content}
""")

        return "\n".join(parts)

    def _extract_statsports_benchmarks(self, content: str) -> str:
        """Extract key performance benchmarks from STATSports data."""
        benchmarks = []

        # Look for team averages
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if 'Team' in line and ('Average' in line or 'Avg' in line):
                # Include this line and a few after it
                benchmarks.append(line.strip())
            elif any(metric in line for metric in ['Total Distance', 'Max Speed', 'Sprint',
                                                     'High Speed', 'Acceleration', 'Deceleration']):
                benchmarks.append(line.strip())

        if benchmarks:
            return "\n".join(benchmarks[:15])  # Limit to key metrics

        return ""

    def _extract_relevant_rules(self, content: str) -> str:
        """Extract rules relevant to match events."""
        # Focus on scoring and foul rules
        relevant_sections = []

        keywords = ['score', 'goal', 'point', 'free', 'penalty', 'foul',
                   'yellow card', 'black card', 'red card', 'advantage']

        lines = content.split('\n')
        for i, line in enumerate(lines):
            if any(kw in line.lower() for kw in keywords):
                # Include context around the match
                start = max(0, i - 1)
                end = min(len(lines), i + 3)
                relevant_sections.append('\n'.join(lines[start:end]))

        if relevant_sections:
            return '\n---\n'.join(relevant_sections[:10])

        return ""

    def _extract_scoring_rules(self, content: str) -> str:
        """Extract scoring-specific rules."""
        scoring_content = []

        # Look for scoring section
        in_scoring_section = False
        for line in content.split('\n'):
            line_lower = line.lower()
            if 'scoring' in line_lower or 'score' in line_lower:
                in_scoring_section = True
            if in_scoring_section:
                scoring_content.append(line)
                if len(scoring_content) > 30:
                    break

        return '\n'.join(scoring_content)

    def _summarize_statsports(self, content: str) -> str:
        """Create a concise summary of STATSports data."""
        # Extract key team metrics
        summary_lines = []

        # Look for player data table
        lines = content.split('\n')
        for line in lines:
            # Include lines with numeric data that look like stats
            if re.search(r'\d+[.,]\d+', line) and len(line) < 200:
                summary_lines.append(line.strip())

        return '\n'.join(summary_lines[:20])


    def extract_document_with_vision(self, filename: str, force: bool = False) -> dict:
        """
        Manually trigger Claude Vision extraction for a specific document.

        Args:
            filename: Name of the PDF file to extract
            force: If True, re-extract even if cached

        Returns:
            dict with status and extracted content
        """
        file_path = self.kb_path / filename
        if not file_path.exists():
            return {"success": False, "error": f"File not found: {filename}"}

        # Clear cache if forcing re-extraction
        if force:
            cache_file = self._vision_cache_path / f"{file_path.stem}.txt"
            if cache_file.exists():
                cache_file.unlink()
                logger.info(f"Cleared cache for {filename}")

        # Extract with vision
        content = self._extract_with_vision(file_path)

        if content:
            # Update the document in memory
            doc_type = self._classify_document(filename)
            metadata = self._extract_metadata(filename, content, doc_type)

            self.documents[filename] = Document(
                filename=filename,
                doc_type=doc_type,
                content=f"# {filename}\n## Extracted via Claude Vision\n\n{content}",
                metadata=metadata
            )

            return {
                "success": True,
                "filename": filename,
                "content_length": len(content),
                "preview": content[:500] + "..." if len(content) > 500 else content
            }
        else:
            return {"success": False, "error": "Vision extraction failed - check API key"}

    def list_documents(self) -> list:
        """List all documents in the knowledge base."""
        if not self._loaded:
            self.load_documents()

        return [
            {
                "filename": doc.filename,
                "doc_type": doc.doc_type,
                "content_length": len(doc.content),
                "has_content": len(doc.content) > 100,
                "metadata": doc.metadata,
                "loaded_at": doc.loaded_at.isoformat()
            }
            for doc in self.documents.values()
        ]

    def get_available_pdfs(self) -> list:
        """List all PDF files in the knowledge base folder."""
        if not self.kb_path.exists():
            return []

        pdfs = []
        for file_path in self.kb_path.glob("*.pdf"):
            # Check if we have cached extraction
            cache_file = self._vision_cache_path / f"{file_path.stem}.txt"
            has_cache = cache_file.exists()

            # Check if loaded in memory
            is_loaded = file_path.name in self.documents
            has_content = is_loaded and len(self.documents[file_path.name].content) > 100

            pdfs.append({
                "filename": file_path.name,
                "size_bytes": file_path.stat().st_size,
                "is_loaded": is_loaded,
                "has_content": has_content,
                "has_vision_cache": has_cache
            })

        return pdfs


# Singleton instance
_kb_service: Optional[KnowledgeBaseService] = None


def get_knowledge_base() -> KnowledgeBaseService:
    """Get the singleton knowledge base service instance."""
    global _kb_service
    if _kb_service is None:
        _kb_service = KnowledgeBaseService()
        _kb_service.load_documents()
    return _kb_service


def reload_knowledge_base() -> KnowledgeBaseService:
    """Force reload the knowledge base (e.g., after adding new files)."""
    global _kb_service
    _kb_service = KnowledgeBaseService()
    _kb_service.load_documents()
    return _kb_service
