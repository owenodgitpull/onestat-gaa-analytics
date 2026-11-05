"""Raw GPS time series per player per match, and the per-match video sync.

See docs/gps-timeseries-design.md. Nothing here is per sample: a track is one packed blob (codec.py).
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, SmallInteger, BigInteger, DateTime, ForeignKey, Text, JSON, LargeBinary, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class MatchGPSTrack(Base):
    __tablename__ = "match_gps_tracks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    device_name = Column(String(120), nullable=True)
    source_filename = Column(String(300), nullable=True)
    hz = Column(SmallInteger, nullable=False, default=10)
    t0_ms = Column(BigInteger, nullable=False)       # UTC epoch ms of sample 0
    n_samples = Column(Integer, nullable=False)
    blob = Column(LargeBinary, nullable=False)        # codec.encode()
    stats = Column(JSON, nullable=True)               # parse + in-match figures (filled by the sync)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    player = relationship("Player")

    __table_args__ = (UniqueConstraint("match_id", "player_id", name="uq_match_gps_tracks_match_player"),)

    @property
    def end_ms(self) -> int:
        return int(self.t0_ms + (self.n_samples - 1) * 1000 / self.hz)


class MatchGPSSync(Base):
    __tablename__ = "match_gps_sync"

    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="pending")   # pending | auto | confirmed | failed
    calibration = Column(JSON, nullable=True)   # geo.py calibration dict + extents + tag bias
    periods = Column(JSON, nullable=True)       # clock.py periods: half, video_start_ms, offset_ms, rate, residuals, anchors, source
    tag_lag = Column(JSON, nullable=True)       # per event type: n, median_s, p25_s, p75_s
    quality = Column(JSON, nullable=True)       # per player_id: in_match, coverage, bad share, in-match distance
    error = Column(Text, nullable=True)

    computed_at = Column(DateTime, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    confirmed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
