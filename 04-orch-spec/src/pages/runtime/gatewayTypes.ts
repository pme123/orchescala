// What a page needs of the gateway - without the login (the designer of orch-spec has none).

/** Ein Aufruf des Gateways, der nicht geklappt hat – die Seite zeigt ihren Text zum Status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** What a page calls - the gateway, or in the designer of orch-spec a stand-in with sample data. */
export type Gateway = {
  call: (service: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  start: (process: string, businessKey: string | undefined, input: unknown, isPublic: boolean) => Promise<unknown>;
  message: (name: string, businessKey: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  completeTask: (taskKey: string, taskId: string, input: unknown) => Promise<unknown>;
};

