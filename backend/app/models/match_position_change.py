"""
MatchPositionChange - a player moving from one position to another DURING a match (a midfielder swapping with a half
forward, a sub switching slot).

`match_lineups.position_id` stays "where the player is now". This table is the history: each row says WHEN a player
changed position and from/to what, so the agents can attribute every event to the position held at that minute and
judge whether a personnel move worked. Starting positions and substitutions need no rows here - the timeline is built
from the lineup, the substitution events and these moves (see services/lineup_timeline.py).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class MatchPositionChange(Base):
    __tablename__ = "match_position_changes"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False)

    from_position_id: Column[str] = Column(String(20), nullable=False)
    to_position_id: Column[str] = Column(String(20), nullable=False)

    # When it took effect. `minute` is the match minute as everywhere else (cumulative, so a 2nd-half minute starts at the
    # half length); the half is stored because first-half added time shares its minutes with the second half.
    half: Column[int] = Column(SmallInteger, nullable=False)
    minute: Column[int] = Column(Integer, nullable=False)
    match_clock_s: Column[Optional[int]] = Column(Integer, nullable=True)
    video_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)   # Video Tagging: lets Undo to Point remove it

    # Idempotency for retried requests: "<client id>:a" / "<client id>:b" for the two sides of a swap
    client_event_id: Column[Optional[str]] = Column(String(80), nullable=True, index=True)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
