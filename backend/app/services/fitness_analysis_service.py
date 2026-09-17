"""
Fitness Analysis Service.

Uses Claude AI to analyze fitness test results and generate:
- Strengths and weaknesses assessment
- Injury risk scoring
- Training recommendations
- Position fit analysis
"""

import os
import json
import logging
import asyncio
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

logger = logging.getLogger(__name__)


class FitnessAnalysisService:
    """Service for AI-powered fitness test analysis."""

    @staticmethod
    async def analyze_test(db: AsyncSession, test) -> dict:
        """
        Analyze a fitness test with AI.

        Args:
            db: Database session
            test: FitnessTest model instance

        Returns:
            dict with analysis results
        """
        try:
            import anthropic
        except ImportError:
            logger.error("anthropic package not installed")
            return FitnessAnalysisService._generate_rule_based_analysis(test)

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set, using rule-based analysis")
            return FitnessAnalysisService._generate_rule_based_analysis(test)

        # Build test data summary
        test_data = {
            "body_metrics": {
                "weight_kg": float(test.weight_kg) if test.weight_kg else None,
                "body_fat_percentage": float(test.body_fat_percentage) if test.body_fat_percentage else None,
            },
            "mobility": {
                "ktw_right_cm": float(test.ktw_right_cm) if test.ktw_right_cm else None,
                "ktw_left_cm": float(test.ktw_left_cm) if test.ktw_left_cm else None,
                "overhead_squat_score": test.overhead_squat_score,
            },
            "power": {
                "cmj_cm": float(test.cmj_cm) if test.cmj_cm else None,
                "squat_jump_cm": float(test.squat_jump_cm) if test.squat_jump_cm else None,
                "eur": test.eur_calculated,
            },
            "strength": {
                "press_ups_60s": test.press_ups_60s,
                "pull_ups_60s": test.pull_ups_60s,
            },
            "speed_conditioning": {
                "sprint_0_10m_sec": float(test.sprint_0_10m_sec) if test.sprint_0_10m_sec else None,
                "bronco_test_min": float(test.bronco_test_min) if test.bronco_test_min else None,
            },
        }

        prompt = f"""Analyze this GAA player's fitness test results and provide a comprehensive assessment.

## Fitness Test Results
{json.dumps(test_data, indent=2)}

## GAA Fitness Benchmarks (for reference)
- Counter Movement Jump (CMJ): 35-45cm is good, >45cm is excellent
- Bronco Test: 4:30-5:00 is excellent, 5:00-5:30 is good, >6:00 needs improvement
- Sprint 0-10m: <1.7s is excellent, 1.7-1.85s is good, >2.0s needs work
- Press-ups (60s): 40+ is excellent, 30-40 is good
- Pull-ups (60s): 15+ is excellent, 10-15 is good
- Knee to Wall: 12+ cm is good, <10cm indicates restricted ankle mobility
- EUR (CMJ/SJ): 1.0-1.15 is normal, >1.15 indicates good elastic energy usage

## Analysis Required
Provide your analysis in the following JSON format:
{{
    "strengths": ["List 2-4 key strengths based on test results"],
    "weaknesses": ["List 2-4 areas that need improvement"],
    "injury_risk_score": <number 1-10, where 10 is the strongest workload/mobility indicator>,
    "injury_risk_factors": ["List specific indicator factors identified, hedged per the tone guidance below"],
    "recommendations": ["List 3-5 specific training recommendations"],
    "position_fit": ["List 2-3 GAA positions this fitness profile suits best"],
    "training_focus": ["List 2-3 priority areas for the next training block"]
}}

Consider:
1. Left/right ankle mobility imbalance
2. EUR ratio for power quality
3. Aerobic capacity for GAA demands
4. Upper body strength for contact situations
5. Speed profile for positional requirements

TONE — this is a fitness-testing indicator, not a medical assessment. This app is not a health/medical
product and never diagnoses anything. Do NOT state or imply a diagnosed medical condition, an existing
injury, or a certain future outcome ("will get injured", "has an injury"). Use hedged, indicator-style
language instead — e.g. "elevated workload indicator", "potential mobility risk indicator", "worth
monitoring" — framing each factor as something for coaching/S&C staff to review, not a verdict.

Respond with ONLY the JSON object, no other text."""

        try:
            client = anthropic.Anthropic(api_key=api_key)
            # Offloaded to a thread — synchronous Anthropic SDK call would
            # otherwise block the whole event loop for the round-trip.
            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}]
            )

            response_text = response.content[0].text

            # Parse JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                analysis = json.loads(json_match.group())
                return analysis
            else:
                logger.error("Could not parse JSON from AI response")
                return FitnessAnalysisService._generate_rule_based_analysis(test)

        except anthropic.AuthenticationError:
            logger.error("Claude API authentication failed")
            return FitnessAnalysisService._generate_rule_based_analysis(test)
        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            return FitnessAnalysisService._generate_rule_based_analysis(test)

    @staticmethod
    def _generate_rule_based_analysis(test) -> dict:
        """
        Generate analysis using simple rules when AI is not available.
        """
        strengths = []
        weaknesses = []
        injury_risk_factors = []
        recommendations = []
        position_fit = []
        training_focus = []

        # Analyze CMJ
        if test.cmj_cm:
            cmj = float(test.cmj_cm)
            if cmj >= 45:
                strengths.append(f"Excellent power output (CMJ: {cmj}cm)")
            elif cmj >= 35:
                strengths.append(f"Good power output (CMJ: {cmj}cm)")
            else:
                weaknesses.append(f"Below average power (CMJ: {cmj}cm)")
                training_focus.append("Plyometric training for power development")

        # Analyze EUR
        if test.eur_calculated:
            eur = test.eur_calculated
            if eur >= 1.15:
                strengths.append(f"Excellent elastic energy utilization (EUR: {eur})")
            elif eur < 1.0:
                weaknesses.append(f"Poor stretch-shortening cycle utilization (EUR: {eur})")
                recommendations.append("Include reactive plyometrics and depth jumps")

        # Analyze Bronco
        if test.bronco_test_min:
            bronco = float(test.bronco_test_min)
            if bronco <= 4.5:
                strengths.append(f"Excellent aerobic capacity (Bronco: {bronco:.2f}min)")
                position_fit.append("Midfield - excellent engine")
            elif bronco <= 5.5:
                pass  # Average
            else:
                weaknesses.append(f"Aerobic capacity needs improvement (Bronco: {bronco:.2f}min)")
                training_focus.append("High-intensity interval training")
                recommendations.append("Add 2-3 aerobic conditioning sessions per week")

        # Analyze sprint
        if test.sprint_0_10m_sec:
            sprint = float(test.sprint_0_10m_sec)
            if sprint < 1.7:
                strengths.append(f"Elite acceleration (0-10m: {sprint:.2f}s)")
                position_fit.append("Inside forward - quick off the mark")
            elif sprint > 2.0:
                weaknesses.append(f"Acceleration needs work (0-10m: {sprint:.2f}s)")
                training_focus.append("Acceleration and first-step quickness")

        # Analyze mobility imbalance
        if test.ktw_right_cm and test.ktw_left_cm:
            right = float(test.ktw_right_cm)
            left = float(test.ktw_left_cm)
            diff = abs(right - left)
            if diff > 2:
                injury_risk_factors.append(f"Ankle mobility imbalance indicator: {diff:.1f}cm difference — worth monitoring")
                recommendations.append("Address ankle mobility asymmetry with targeted stretching")

            if right < 10 or left < 10:
                injury_risk_factors.append("Restricted ankle mobility — a potential mobility indicator worth monitoring")
                recommendations.append("Daily ankle mobility drills")

        # Analyze overhead squat
        if test.overhead_squat_score and test.overhead_squat_score < 2:
            injury_risk_factors.append("Movement quality indicator in overhead squat — worth monitoring")
            recommendations.append("Movement quality screening and corrective exercise")

        # Calculate injury risk score
        injury_risk_score = 3  # Base score
        injury_risk_score += len(injury_risk_factors) * 2
        injury_risk_score = min(injury_risk_score, 10)

        # Add default recommendations if empty
        if not recommendations:
            recommendations.append("Maintain current training load")
            recommendations.append("Continue balanced strength and conditioning program")

        if not position_fit:
            position_fit.append("Versatile profile - suits multiple positions")

        if not training_focus:
            training_focus.append("General fitness maintenance")

        return {
            "strengths": strengths or ["Balanced fitness profile"],
            "weaknesses": weaknesses or ["No significant weaknesses identified"],
            "injury_risk_score": injury_risk_score,
            "injury_risk_factors": injury_risk_factors or ["No major risk factors identified"],
            "recommendations": recommendations,
            "position_fit": position_fit,
            "training_focus": training_focus,
        }

    @staticmethod
    async def analyze_squad(db: AsyncSession) -> dict:
        """
        Analyze overall squad fitness state.

        Returns aggregated insights and team-wide recommendations.
        """
        from app.models.fitness_test import FitnessTest
        from app.models.player import Player

        # Get latest tests for each player
        subquery = select(
            FitnessTest.player_id,
            func.max(FitnessTest.test_date).label('max_date')
        ).group_by(FitnessTest.player_id).subquery()

        query = select(FitnessTest).join(
            subquery,
            (FitnessTest.player_id == subquery.c.player_id) &
            (FitnessTest.test_date == subquery.c.max_date)
        )

        result = await db.execute(query)
        tests = result.scalars().all()

        if not tests:
            return {
                "squad_size": 0,
                "tested_count": 0,
                "team_strengths": [],
                "team_weaknesses": [],
                "priority_areas": [],
                "recommendations": ["No fitness test data available"],
            }

        # Aggregate metrics
        cmj_values = [float(t.cmj_cm) for t in tests if t.cmj_cm]
        bronco_values = [float(t.bronco_test_min) for t in tests if t.bronco_test_min]
        sprint_values = [float(t.sprint_0_10m_sec) for t in tests if t.sprint_0_10m_sec]

        team_strengths = []
        team_weaknesses = []
        priority_areas = []
        recommendations = []

        # Analyze team averages
        if cmj_values:
            avg_cmj = sum(cmj_values) / len(cmj_values)
            if avg_cmj >= 40:
                team_strengths.append(f"Strong power output across squad (avg CMJ: {avg_cmj:.1f}cm)")
            elif avg_cmj < 35:
                team_weaknesses.append(f"Power development needed (avg CMJ: {avg_cmj:.1f}cm)")
                priority_areas.append("Plyometric training program")

        if bronco_values:
            avg_bronco = sum(bronco_values) / len(bronco_values)
            if avg_bronco <= 5.0:
                team_strengths.append(f"Good aerobic base (avg Bronco: {avg_bronco:.2f}min)")
            elif avg_bronco > 5.5:
                team_weaknesses.append(f"Conditioning needs improvement (avg Bronco: {avg_bronco:.2f}min)")
                priority_areas.append("Aerobic conditioning focus")
                recommendations.append("Implement team-wide conditioning block")

        # Count players with mobility issues
        mobility_concerns = 0
        for t in tests:
            if t.ktw_right_cm and t.ktw_left_cm:
                if abs(float(t.ktw_right_cm) - float(t.ktw_left_cm)) > 2:
                    mobility_concerns += 1

        if mobility_concerns > len(tests) * 0.3:
            team_weaknesses.append(f"{mobility_concerns} players have ankle mobility imbalances")
            recommendations.append("Add ankle mobility work to warm-ups")

        # Count high injury risk players
        high_risk = sum(1 for t in tests if t.injury_risk_score and t.injury_risk_score >= 7)
        if high_risk > 0:
            recommendations.append(f"Monitor {high_risk} player(s) with elevated injury risk")

        return {
            "squad_size": len(tests),
            "tested_count": len(tests),
            "avg_cmj": round(sum(cmj_values) / len(cmj_values), 1) if cmj_values else None,
            "avg_bronco": round(sum(bronco_values) / len(bronco_values), 2) if bronco_values else None,
            "avg_sprint": round(sum(sprint_values) / len(sprint_values), 2) if sprint_values else None,
            "team_strengths": team_strengths or ["Balanced squad fitness"],
            "team_weaknesses": team_weaknesses or ["No major weaknesses"],
            "priority_areas": priority_areas or ["Maintain current program"],
            "recommendations": recommendations or ["Continue balanced training approach"],
            "high_risk_count": high_risk,
            "mobility_concern_count": mobility_concerns,
        }
