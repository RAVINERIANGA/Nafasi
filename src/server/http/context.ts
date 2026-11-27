import type { ConnectivityMode } from "@/domain/types";

export type RequestContext = {
  deviceId: string;
  deviceLabel: string;
  deviceTime: string;
  connectivity: ConnectivityMode;
  token?: string;
  pinToken?: string;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
