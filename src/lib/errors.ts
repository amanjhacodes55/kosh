/** An error with an HTTP status whose message is safe to show the user. */
export class BankError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (message: string, status = 400): never => {
  throw new BankError(status, message);
};
