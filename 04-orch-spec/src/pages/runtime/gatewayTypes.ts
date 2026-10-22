// What a page needs from the gateway - without the sign-in (the orch-spec designer has none).

/** A gateway call that did not work – the page shows its text for the status.
  * `login`: the sign-in itself does not work (IdP gone, config.json missing) - the page shows the message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: 'gateway' | 'login' = 'gateway',
  ) {
    super(message);
  }
}

/** What a page calls - the gateway, or in the orch-spec designer a substitute with sample data. */
export type Gateway = {
  call: (service: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  start: (process: string, businessKey: string | undefined, input: unknown, isPublic: boolean) => Promise<unknown>;
  message: (name: string, businessKey: string, input: unknown, isPublic: boolean) => Promise<unknown>;
  completeTask: (taskKey: string, taskId: string, input: unknown) => Promise<unknown>;
};

