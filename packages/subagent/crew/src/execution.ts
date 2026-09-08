/** Resource limits for authorized commands running through the DSH subprocess service. */

/** Operator-owned resource limits resolved before a command starts. */
export interface CrewExecutionLimits {
  readonly maxOutputBytes: number
  readonly processGraceMs: number
  readonly gitTimeoutMs: number
}
