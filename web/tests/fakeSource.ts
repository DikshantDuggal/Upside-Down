export class FakeSource extends EventTarget {
  closed = false;
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    this.dispatchEvent(
      new MessageEvent(type, {
        data: typeof data === "string" ? data : JSON.stringify(data),
      }),
    );
  }
}
