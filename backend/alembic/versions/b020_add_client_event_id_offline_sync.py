"""Add client_event_id columns for offline sync deduplication.

Adds client_event_id (indexed, nullable) to match_events, possession_events,
ball_carrier_segments, and formation_snapshots tables. Used by the offline-first
sync engine to prevent duplicate records when retrying failed API calls.

Revision ID: b020a0000020
Revises: b019a0000019
"""

from alembic import op
import sqlalchemy as sa

revision = "b020a0000020"
down_revision = "b019a0000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # match_events already has client_event_id from model definition,
    # but may not have it in DB yet — use batch_alter for safety
    op.add_column("possession_events", sa.Column("client_event_id", sa.String(64), nullable=True))
    op.create_index("ix_possession_events_client_event_id", "possession_events", ["client_event_id"])

    op.add_column("ball_carrier_segments", sa.Column("client_event_id", sa.String(64), nullable=True))
    op.create_index("ix_ball_carrier_segments_client_event_id", "ball_carrier_segments", ["client_event_id"])

    op.add_column("formation_snapshots", sa.Column("client_event_id", sa.String(64), nullable=True))
    op.create_index("ix_formation_snapshots_client_event_id", "formation_snapshots", ["client_event_id"])

    # match_events — add if not already present (was added to model but may not be migrated)
    try:
        op.add_column("match_events", sa.Column("client_event_id", sa.String(64), nullable=True))
        op.create_index("ix_match_events_client_event_id", "match_events", ["client_event_id"])
    except Exception:
        pass  # Column may already exist from model auto-create in dev


def downgrade() -> None:
    op.drop_index("ix_formation_snapshots_client_event_id", table_name="formation_snapshots")
    op.drop_column("formation_snapshots", "client_event_id")

    op.drop_index("ix_ball_carrier_segments_client_event_id", table_name="ball_carrier_segments")
    op.drop_column("ball_carrier_segments", "client_event_id")

    op.drop_index("ix_possession_events_client_event_id", table_name="possession_events")
    op.drop_column("possession_events", "client_event_id")

    try:
        op.drop_index("ix_match_events_client_event_id", table_name="match_events")
        op.drop_column("match_events", "client_event_id")
    except Exception:
        pass
