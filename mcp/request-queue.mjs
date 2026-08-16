export class RequestQueue {
  #tail = Promise.resolve();
  #closing = false;

  enqueue(task) {
    if (this.#closing) return Promise.reject(new Error("server_shutting_down"));
    const result = this.#tail.then(task);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(closeResource) {
    this.#closing = true;
    await this.#tail;
    await closeResource();
  }
}
