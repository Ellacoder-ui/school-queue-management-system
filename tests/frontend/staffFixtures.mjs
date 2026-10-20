// Synthetic browser/unit data only; never imported by product source.
export function staffFixture(actor='20000000-0000-4000-8000-000000000001') {
  const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,codes=['TP','SOA','PNEP','REF','ADJ']
  const directory=[{id:actor,email:'admin@example.invalid',role:'ADMIN',enabled:true,verified_factors:0,google_identity:1},
    {id:id(2),email:'cashier@example.invalid',role:'CASHIER',enabled:true,verified_factors:0,google_identity:1},
    {id:id(3),email:'student@example.invalid',role:'STUDENT',enabled:true,verified_factors:0,google_identity:1}]
  const configuration={accounts:directory.map(({id,role,enabled})=>({id,role,enabled})),
    counters:codes.map((code,i)=>({id:id(100+i),number:i+1,label:'Counter '+(i+1),is_open:i===0})),
    services:codes.map((code,i)=>({id:id(200+i),code,name:code,enabled:true})),
    counter_services:codes.map((code,i)=>({counter_id:id(100+i),service_id:id(200+i)})),staff_assignments:[{account_id:id(2),counter_id:id(100)}],days:[]}
  return {directory,configuration}
}
