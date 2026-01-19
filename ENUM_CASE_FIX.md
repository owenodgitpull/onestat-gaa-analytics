# Enum Case Fix (2026-01-19)

## Issue
The PostgreSQL enum types (`eventtype`, `team`) were created with **uppercase** values (e.g., `'GOAL'`, `'POINT'`, `'DUNGLOE'`) instead of **lowercase** values (e.g., `'goal'`, `'point'`, `'dungloe'`).

This caused the backend to crash when receiving lowercase strings from the frontend:
```
asyncpg.exceptions.InvalidTextRepresentationError: invalid input value for enum eventtype: "UNFORCED_ERROR"
```

## Root Cause
SQLAlchemy's `Enum()` column type, by default, uses the Python enum's **name** (uppercase) for the database enum values instead of the enum's **value** (lowercase).

Our Python enum was defined as:
```python
class EventType(enum.Enum):
    UNFORCED_ERROR = "unforced_error"  # name=UNFORCED_ERROR, value=unforced_error
```

But the database enum was created with `'UNFORCED_ERROR'` (the name) instead of `'unforced_error'` (the value).

## Solution

### 1. Database Migration
Ran a one-time migration script to:
- Convert `event_type` and `team` columns to VARCHAR
- Lowercase all existing data
- Drop and recreate enums with lowercase values
- Convert columns back to enum types

All existing match data was preserved with lowercase values.

### 2. Schema Validation (Backend)
Added `@field_validator` decorators to `MatchEventBase` in `backend/app/schemas/match_event.py`:

```python
@field_validator('event_type', mode='before')
@classmethod
def parse_event_type(cls, v):
    """Parse event_type by enum VALUE, not name."""
    if isinstance(v, str):
        # Try to find enum by value (e.g., "unforced_error")
        for member in EventType:
            if member.value == v.lower():
                return member
        # Fallback to name (e.g., "UNFORCED_ERROR")
        try:
            return EventType[v.upper()]
        except KeyError:
            raise ValueError(f"Invalid event_type: {v}")
    return v
```

This ensures Pydantic correctly parses lowercase strings from the frontend to enum objects.

### 3. Frontend (No Changes Needed)
The frontend already sends lowercase values via the `mapEventTypeToBackend()` function in `MatchRecording.tsx`.

## Testing
After the fix:
1. Start the backend (it will auto-reload)
2. Record an "Unforced Error" event
3. Should save successfully without 422 errors

## Future Prevention
- Always use enum **values** (lowercase) for API communication
- The field validators ensure case-insensitive parsing
- Database enums now match Python enum values exactly
