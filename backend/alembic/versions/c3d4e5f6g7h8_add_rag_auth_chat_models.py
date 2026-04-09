"""add rag auth and chat models

Revision ID: c3d4e5f6g7h8
Revises: a1b2c3d4e5f6
Create Date: 2026-04-09

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6g7h8'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- User table: new profile columns --
    op.add_column('users', sa.Column('name', sa.String(), nullable=True))
    op.add_column('users', sa.Column('role', sa.String(), nullable=True, server_default='user'))
    op.add_column('users', sa.Column('created_at', sa.String(), nullable=True))
    op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=True, server_default='1'))

    # -- DocumentChunk: page tracking --
    op.add_column('document_chunks', sa.Column('page_number', sa.Integer(), nullable=True))
    op.add_column('document_chunks', sa.Column('token_count', sa.Integer(), nullable=True))

    # -- Credentials table --
    op.create_table(
        'credentials',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('failed_attempts', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('last_login', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index(op.f('ix_credentials_id'), 'credentials', ['id'], unique=False)
    op.create_index(op.f('ix_credentials_email'), 'credentials', ['email'], unique=False)

    # -- Session tokens table --
    op.create_table(
        'session_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('issued_at', sa.String(), nullable=False),
        sa.Column('expires_at', sa.String(), nullable=False),
        sa.Column('is_revoked', sa.Boolean(), nullable=True, server_default='0'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_id'),
    )
    op.create_index(op.f('ix_session_tokens_id'), 'session_tokens', ['id'], unique=False)
    op.create_index(op.f('ix_session_tokens_token_id'), 'session_tokens', ['token_id'], unique=False)

    # -- Chat sessions table --
    op.create_table(
        'chat_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('guest_id', sa.String(), nullable=True),
        sa.Column('started_at', sa.String(), nullable=False),
        sa.Column('last_activity', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id'),
    )
    op.create_index(op.f('ix_chat_sessions_id'), 'chat_sessions', ['id'], unique=False)
    op.create_index(op.f('ix_chat_sessions_session_id'), 'chat_sessions', ['session_id'], unique=False)

    # -- Queries table --
    op.create_table(
        'queries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('query_id', sa.String(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('asked_at', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.session_id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('query_id'),
    )
    op.create_index(op.f('ix_queries_id'), 'queries', ['id'], unique=False)
    op.create_index(op.f('ix_queries_query_id'), 'queries', ['query_id'], unique=False)

    # -- Answers table --
    op.create_table(
        'answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('answer_id', sa.String(), nullable=False),
        sa.Column('query_id', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['query_id'], ['queries.query_id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('answer_id'),
    )
    op.create_index(op.f('ix_answers_id'), 'answers', ['id'], unique=False)
    op.create_index(op.f('ix_answers_answer_id'), 'answers', ['answer_id'], unique=False)

    # Backfill credentials for existing users
    op.execute(
        "INSERT INTO credentials (user_id, email, password_hash, failed_attempts) "
        "SELECT id, email, password_hash, 0 FROM users "
        "WHERE id NOT IN (SELECT user_id FROM credentials)"
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_answers_answer_id'), table_name='answers')
    op.drop_index(op.f('ix_answers_id'), table_name='answers')
    op.drop_table('answers')

    op.drop_index(op.f('ix_queries_query_id'), table_name='queries')
    op.drop_index(op.f('ix_queries_id'), table_name='queries')
    op.drop_table('queries')

    op.drop_index(op.f('ix_chat_sessions_session_id'), table_name='chat_sessions')
    op.drop_index(op.f('ix_chat_sessions_id'), table_name='chat_sessions')
    op.drop_table('chat_sessions')

    op.drop_index(op.f('ix_session_tokens_token_id'), table_name='session_tokens')
    op.drop_index(op.f('ix_session_tokens_id'), table_name='session_tokens')
    op.drop_table('session_tokens')

    op.drop_index(op.f('ix_credentials_email'), table_name='credentials')
    op.drop_index(op.f('ix_credentials_id'), table_name='credentials')
    op.drop_table('credentials')

    op.drop_column('document_chunks', 'token_count')
    op.drop_column('document_chunks', 'page_number')

    op.drop_column('users', 'is_active')
    op.drop_column('users', 'created_at')
    op.drop_column('users', 'role')
    op.drop_column('users', 'name')
