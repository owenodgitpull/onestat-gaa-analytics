"""Add organizations and user_club_memberships tables.

Multi-team licensing support: Organization is the billing entity,
UserClubMembership is the many-to-many between users and clubs.
Club gets an organization_id FK. Backfill creates default orgs
and memberships for all existing users.

Revision ID: b019a0000019
Revises: b018a0000018
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "b019a0000019"
down_revision = "b018a0000018"
depends_on = None


def upgrade() -> None:
    # 1. Create organizations table
    op.create_table(
        "organizations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("owner_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subscription_tier", sa.String(20), nullable=False, server_default="free"),
        sa.Column("max_teams", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("stripe_customer_id", sa.String(100), unique=True, nullable=True),
        sa.Column("stripe_subscription_id", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_organizations_id", "organizations", ["id"])
    op.create_index("ix_organizations_owner", "organizations", ["owner_user_id"])

    # 2. Create user_club_memberships table
    op.create_table(
        "user_club_memberships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="player"),
        sa.Column("player_id", UUID(as_uuid=True), sa.ForeignKey("players.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("joined_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "club_id", name="uq_user_club"),
    )
    op.create_index("ix_user_club_memberships_id", "user_club_memberships", ["id"])
    op.create_index("ix_user_club_memberships_user_id", "user_club_memberships", ["user_id"])
    op.create_index("ix_user_club_memberships_club_id", "user_club_memberships", ["club_id"])

    # 3. Add organization_id to clubs
    op.add_column("clubs", sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=True))
    op.create_index("ix_clubs_organization_id", "clubs", ["organization_id"])

    # 4. Backfill: create an Organization for each club and memberships for each user
    # Uses raw SQL for efficiency in migration context
    conn = op.get_bind()

    # For each club, find the first admin user and create an org
    clubs = conn.execute(sa.text("""
        SELECT c.id, c.name, u.id as admin_user_id
        FROM clubs c
        LEFT JOIN users u ON u.club_id = c.id AND u.role = 'club_admin'
        WHERE c.is_active = true
        ORDER BY c.id, u.created_at
    """)).fetchall()

    # Track which clubs already have orgs (dedup multiple admins)
    orgs_created = {}
    for club_id, club_name, admin_user_id in clubs:
        if club_id in orgs_created or not admin_user_id:
            continue
        org_id = conn.execute(sa.text("""
            INSERT INTO organizations (id, name, owner_user_id, subscription_tier, max_teams)
            VALUES (gen_random_uuid(), :name, :owner_id, 'free', 1)
            RETURNING id
        """), {"name": club_name, "owner_id": admin_user_id}).scalar()

        conn.execute(sa.text("""
            UPDATE clubs SET organization_id = :org_id WHERE id = :club_id
        """), {"org_id": org_id, "club_id": club_id})

        orgs_created[club_id] = org_id

    # Create memberships for all users that have a club_id
    conn.execute(sa.text("""
        INSERT INTO user_club_memberships (id, user_id, club_id, role, player_id, is_active, joined_at)
        SELECT gen_random_uuid(), u.id, u.club_id, u.role, u.player_id, u.is_active, COALESCE(u.created_at, NOW())
        FROM users u
        WHERE u.club_id IS NOT NULL
        ON CONFLICT (user_id, club_id) DO NOTHING
    """))


def downgrade() -> None:
    op.drop_index("ix_clubs_organization_id", table_name="clubs")
    op.drop_column("clubs", "organization_id")
    op.drop_table("user_club_memberships")
    op.drop_table("organizations")
