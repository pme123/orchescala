// Was eine Seite vom Gateway braucht - ohne die Anmeldung (der Designer von orch-spec hat keine).

/** Ein Aufruf des Gateways, der nicht geklappt hat – die Seite zeigt ihren Text zum Status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Was eine Seite aufruft - der Gateway, oder im Designer von orch-spec ein Ersatz mit Beispieldaten. */
export type Gateway = {
  call: (service: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  start: (process: string, businessKey: string | undefined, input: unknown, isPublic: boolean) => Promise<unknown>;
  message: (name: string, businessKey: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  completeTask: (taskKey: string, taskId: string, input: unknown) => Promise<unknown>;
};

