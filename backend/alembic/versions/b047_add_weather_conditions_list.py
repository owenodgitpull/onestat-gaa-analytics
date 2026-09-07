"""Add matches.weather_conditions (multi-select weather).

Real weather is combinatorial (windy AND raining), and the existing single
weather_condition enum column can't represent that without an ever-growing
set of named combo values (windy_rain, windy_cold_foggy, ...) which would
also fragment the "split by weather" AI pattern-analysis tool instead of
helping it. weather_conditions is a JSON list of the same WeatherCondition
string values instead. weather_condition (singular) is kept and now
auto-synced server-side to the first entry of weather_conditions, purely so
the several pre-existing single-icon weather badges around the app keep
working unchanged.

Revision ID: b047a0000047
Revises: b046a0000046
Create Date: 2026-09-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b047a0000047'
down_revision = 'b046a0000046'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('matches', sa.Column('weather_conditions', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('matches', 'weather_conditions')
