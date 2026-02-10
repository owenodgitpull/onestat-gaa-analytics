"""
Flexible GPS Data Parser
Handles multiple GPS device formats: StatSports, Catapult, Playertek, etc.
"""

import pandas as pd
import re
from typing import Dict, List, Optional
from datetime import datetime

class GPSDataParser:
    """
    Auto-detects GPS data format and normalizes to standard schema
    """
    
    # Common GPS metric mappings across different systems
    METRIC_ALIASES = {
        'total_distance': [
            'total distance', 'distance', 'total_distance_m', 
            'distance covered', 'tot dist', 'total dist (m)'
        ],
        'high_speed_running': [
            'hsr', 'high speed running', 'hsr distance', 'hsr_m',
            'distance >19.8 km/h', 'high speed distance'
        ],
        'sprint_distance': [
            'sprint', 'sprint distance', 'sprint_m', 'sprinting',
            'distance >25 km/h', 'very high speed running'
        ],
        'max_speed': [
            'max speed', 'maximum speed', 'top speed', 'peak speed',
            'max_speed_kmh', 'vmax'
        ],
        'accelerations': [
            'acc', 'accelerations', 'accel', 'no. accelerations',
            'acceleration count', 'accel >3m/s²'
        ],
        'decelerations': [
            'dec', 'decelerations', 'decel', 'no. decelerations',
            'deceleration count', 'decel >3m/s²'
        ],
        'player_load': [
            'player load', 'total load', 'pl', 'playerload',
            'mechanical load', 'body load'
        ],
        'dynamic_stress': [
            'dsl', 'dynamic stress load', 'stress load', 'dyn stress'
        ],
        'hml_distance': [
            'hml', 'high metabolic load', 'hml distance', 'hml_m'
        ],
        'sprint_count': [
            'sprints', 'sprint count', 'no. sprints', '# sprints',
            'sprint efforts'
        ],
        'step_balance': [
            'step balance', 'step balance left', 'step bal',
            'left step', 'balance left %', 'step balance l %'
        ]
    }
    
    @classmethod
    def detect_format(cls, df: pd.DataFrame) -> str:
        """
        Auto-detect GPS system from column names/patterns
        """
        cols = [c.lower() for c in df.columns]
        
        if 'statsports' in str(df.head()).lower() or 'apex' in str(df.head()).lower():
            return 'statsports'
        elif 'catapult' in str(df.head()).lower():
            return 'catapult'
        elif 'playertek' in str(df.head()).lower():
            return 'playertek'
        elif 'polar' in str(df.head()).lower():
            return 'polar'
        else:
            return 'generic'
    
    @classmethod
    def normalize_column_name(cls, col_name: str) -> Optional[str]:
        """
        Map any GPS column name to our standard schema
        """
        col_lower = col_name.lower().strip()
        
        for standard_name, aliases in cls.METRIC_ALIASES.items():
            if col_lower in aliases:
                return standard_name
            # Fuzzy matching
            for alias in aliases:
                if alias in col_lower or col_lower in alias:
                    return standard_name
        
        return None
    
    @classmethod
    def parse_gps_file(cls, file_path: str) -> Dict:
        """
        Parse any GPS CSV file and return standardized data
        
        Returns:
        {
            'format': 'statsports',
            'date': '2026-01-03',
            'session_type': 'training',
            'players': [
                {
                    'name': 'Aaron Ward',
                    'metrics': {
                        'total_distance_m': 5420,
                        'high_speed_running_m': 324,
                        'max_speed_kmh': 28.4,
                        ...
                    },
                    'raw_data': {...}  # Store everything we don't recognize
                }
            ]
        }
        """
        # Try multiple encodings
        for encoding in ['utf-8', 'latin1', 'iso-8859-1']:
            try:
                df = pd.read_csv(file_path, encoding=encoding)
                break
            except:
                continue
        else:
            raise ValueError("Could not read file with any standard encoding")
        
        # Detect format
        format_type = cls.detect_format(df)
        
        # Find date (usually in filename or first few rows)
        date = cls.extract_date(file_path, df)
        
        # Find player name column
        player_col = cls.find_player_column(df)
        
        if not player_col:
            raise ValueError("Could not identify player name column")
        
        # Parse each player's data
        players = []
        for _, row in df.iterrows():
            player_name = str(row[player_col]).strip()
            
            if not player_name or player_name.lower() in ['nan', 'none', '']:
                continue
            
            # Normalize metrics
            metrics = {}
            raw_data = {}
            
            for col in df.columns:
                if col == player_col:
                    continue
                
                value = row[col]
                
                # Try to normalize
                standard_name = cls.normalize_column_name(col)
                
                if standard_name:
                    # Convert to appropriate type
                    try:
                        if 'distance' in standard_name or 'count' in standard_name:
                            metrics[standard_name + '_m' if 'distance' in standard_name else ''] = int(float(value))
                        elif 'speed' in standard_name:
                            metrics[standard_name + '_kmh'] = float(value)
                        else:
                            metrics[standard_name] = float(value)
                    except (ValueError, TypeError):
                        raw_data[col] = str(value)
                else:
                    # Store unknown columns in raw_data
                    raw_data[col] = str(value)
            
            players.append({
                'name': player_name,
                'metrics': metrics,
                'raw_data': raw_data
            })
        
        return {
            'format': format_type,
            'date': date,
            'session_type': 'unknown',  # Can be set manually after upload
            'players': players
        }
    
    @staticmethod
    def find_player_column(df: pd.DataFrame) -> Optional[str]:
        """Find which column contains player names"""
        possible_names = ['player', 'name', 'athlete', 'player name', 'full name']
        
        for col in df.columns:
            col_lower = col.lower().strip()
            if col_lower in possible_names:
                return col
        
        # Default to first column if not found
        return df.columns[0] if len(df.columns) > 0 else None
    
    @staticmethod
    def extract_date(file_path: str, df: pd.DataFrame) -> str:
        """Extract date from filename or file content"""
        import re
        from datetime import datetime
        
        # Try filename first
        date_patterns = [
            r'(\d{4}-\d{2}-\d{2})',  # 2026-01-03
            r'(\d{2}-\d{2}-\d{4})',  # 03-01-2026
            r'(\d{8})',              # 20260103
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, file_path)
            if match:
                try:
                    date_str = match.group(1)
                    # Try to parse
                    for fmt in ['%Y-%m-%d', '%d-%m-%Y', '%Y%m%d']:
                        try:
                            dt = datetime.strptime(date_str, fmt)
                            return dt.strftime('%Y-%m-%d')
                        except:
                            continue
                except:
                    pass
        
        # Look in first few rows of data
        for col in df.columns:
            if 'date' in col.lower():
                return str(df[col].iloc[0])
        
        # Default to today
        return datetime.now().strftime('%Y-%m-%d')


# Example usage
if __name__ == "__main__":
    parser = GPSDataParser()
    
    # This will work with ANY GPS format
    data = parser.parse_gps_file("training_data_03_jan_2026.csv")
    
    print(f"Detected format: {data['format']}")
    print(f"Date: {data['date']}")
    print(f"Players found: {len(data['players'])}")
    
    for player in data['players'][:2]:  # Show first 2
        print(f"\n{player['name']}:")
        print(f"  Metrics: {player['metrics']}")
        if player['raw_data']:
            print(f"  Unknown fields: {list(player['raw_data'].keys())}")


