// Release lock: the installed handoff includes reads only. Enabling this requires
// separately approved backend installation and frontend acceptance. This flag is
// not authorization; PostgreSQL must still enforce every privileged operation.
export const STAFF_ACTIVATION_RELEASED = false
