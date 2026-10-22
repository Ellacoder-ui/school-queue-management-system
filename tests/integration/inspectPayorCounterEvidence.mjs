// Fixed retained read-only check for ticket counter evidence; emits no owner data.
import { QueueFixture, need } from './queueFixture.mjs'

const fixture = new QueueFixture()
await fixture.retained()
await fixture.inventory()
const cluster = fixture.retainedRead('select system_identifier::text from pg_control_system()').trim()
need(cluster === '7696959712798593061', 'Wrong retained cluster')
const query = `select coalesce(json_agg(json_build_object(
 'service',s.code,'number',t.sequence_number,'date',d.business_date,'status',t.status,
 'ticket_counter',c.number,
 'event_counters',(select json_agg(json_build_object('event',e.event_type,'counter',ec.number) order by e.occurred_at,e.id)
   from queue_private.ticket_events e left join queue_private.counters ec on ec.id=e.counter_id
   where e.ticket_id=t.id and e.event_type in ('CALLED','SERVED','FORFEITED')))
 order by d.business_date,s.code,t.sequence_number),'[]'::json)
from queue_private.tickets t join queue_private.services s on s.id=t.service_id
join queue_private.queue_days d on d.id=t.queue_day_id left join queue_private.counters c on c.id=t.counter_id
where (s.code,t.sequence_number) in (('REF',1),('REF',2),('SOA',1))`
const rows = JSON.parse(fixture.retainedRead(query).trim())
console.log(JSON.stringify({ cluster, rows }))
