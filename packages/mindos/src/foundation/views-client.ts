export class ViewsClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export class ViewsClient {
  private readonly options: {
    baseUrl: string;
    token?: string;
    agentName?: string;
    fetch?: typeof fetch;
  };
  constructor(options: {
    baseUrl: string;
    token?: string;
    agentName?: string;
    fetch?: typeof fetch;
  }) {
    this.options = options;
  }
  async request(
    op: string,
    input: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL("/api/views/v2", this.options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ViewsClientError(
        "INVALID_ORIGIN",
        "Invalid MindOS address",
        400,
      );
    const write =
        [
          "create",
          "mutate",
          "save",
          "page.preview",
          "page.generate",
          "page.save",
          "page.restore",
          "page.remove",
          'project.save','project.interact','project.page',
        ].includes(op) ||
        (op === "preview" && !input.draftId),
      headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.token)
      headers.Authorization = "Bearer " + this.options.token;
    if (this.options.agentName)
      headers["x-mindos-agent"] = this.options.agentName
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, 100);
    if (!write) {
      url.searchParams.set("op", op);
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) url.searchParams.set(k, String(v));
    }
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: write ? "POST" : "GET",
        headers,
        ...(write ? { body: JSON.stringify({ ...input, op }) } : {}),
        signal: AbortSignal.timeout(op === "page.generate" ? 105000 : 15000),
        redirect: "error",
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new ViewsClientError(
          String(body.error ?? "REQUEST_FAILED"),
          String(body.message ?? body.error ?? response.statusText),
          response.status,
        );
      return body;
    } catch (e) {
      if (e instanceof ViewsClientError) throw e;
      throw new ViewsClientError(
        "SERVICE_UNAVAILABLE",
        "MindOS is unavailable. Start the selected runtime; retry the same operation ID after checking its receipt.",
      );
    }
  }
}
