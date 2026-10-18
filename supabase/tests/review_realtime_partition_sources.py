"""Read fixed public pinned sources only; save new hashes and review facts.

No Docker, database, backup, credential or mutation path. Bodies stay in memory.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request
import uuid

COMMIT = 'fa948248588b55692114c9c3536cd71780d14e4b'
PATHS = [
    'lib/realtime/messages.ex', 'lib/realtime/tenants.ex',
    'lib/realtime/tenants/janitor.ex', 'lib/realtime/tenants/janitor/maintenance_task.ex',
    'lib/realtime/tenants/connect.ex', 'lib/realtime/application.ex', 'config/runtime.exs',
    'test/realtime/messages_test.exs', 'test/realtime/tenants/janitor/maintenance_task_test.exs',
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read(path):
    assert path in PATHS
    url = f'https://raw.githubusercontent.com/supabase/realtime/{COMMIT}/{path}'
    request = urllib.request.Request(url, headers={'User-Agent': 'local-readonly-source-review'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        body = response.read(1024 * 1024 + 1)
        assert response.status == 200 and len(body) <= 1024 * 1024
    return path, body


def main():
    with ThreadPoolExecutor(max_workers=4) as pool:
        files = dict(pool.map(read, PATHS))
    text = {p: b.decode('utf-8') for p, b in files.items()}
    messages = text['lib/realtime/messages.ex'].split('def delete_old_messages(conn) do', 1)[1]
    assert 'NaiveDateTime.add(-72, :hour)' in messages
    assert 'Date.compare(limit) == :lt' in messages and 'DROP TABLE IF EXISTS realtime.' in messages
    assert not any(token in messages.lower() for token in ('count(', 'not exists', 'select 1', 'limit 1'))
    assert 'Date.add(today, -1)' in text['lib/realtime/tenants.ex']
    assert 'Date.add(today, 3)' in text['lib/realtime/tenants.ex']
    assert 'supabase_realtime_admin' in text['lib/realtime/tenants.ex']
    assert 'Messages.delete_old_messages(conn)' in text['lib/realtime/tenants/janitor/maintenance_task.ex']
    assert 'timer + :timer.minutes(Enum.random(1..59))' in text['lib/realtime/tenants/janitor.ex']
    record = {
        'result': 'PASS_PINNED_SOURCE_REVIEW_NOT_DELETION_ATTRIBUTION',
        'checked_at': datetime.now(timezone.utc).isoformat(), 'tag': 'v2.143.4', 'commit': COMMIT,
        'files': [{'path': p, 'url': f'https://github.com/supabase/realtime/blob/{COMMIT}/{p}',
                   'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for p, b in files.items()],
        'review': {
            'creation_utc_day_offsets_inclusive': [-1, 3],
            'cleanup_cutoff': 'UTC date of current naive UTC time minus 72 hours',
            'drop_predicate': 'date parsed from child name strictly before cutoff date',
            'drop_checks_empty': False,
            'cleanup_parent_query': 'parent name messages; child schema realtime; parent schema not filtered',
            'cleanup_bound_or_acl_validation': False,
            'maintenance_order': ['delete old messages partitions', 'create daily partitions'],
            'connection_initialization': 'creates partitions after migrations; not this cleanup call',
            'janitor_timer_defaults': {'run': False, 'initial_extra_ms': 600000,
                'interval_ms': 14400000, 'randomize': True, 'jitter_minutes_inclusive': [1, 59]},
            'provenance': 'Pinned implementation and upstream tests; not execution of those tests or proof of an individual DDL actor',
        },
    }
    path = Path(__file__).resolve().parent / 'results' / f'realtime_lifecycle_pinned_source_{uuid.uuid4().hex[:8]}.json'
    with path.open('x', encoding='utf-8') as handle:
        json.dump(record, handle, indent=2)
    print(json.dumps({'result': record['result'], 'evidence': path.name,
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
