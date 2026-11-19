export interface PDCredentials {
  apiToken: string;
}

export interface PDUser {
  id: string;
  type: string;
  name: string;
  email: string;
  role: string;
  html_url?: string;
}

export interface PDService {
  id: string;
  type: string;
  name: string;
  description?: string;
  status?: string;
  html_url?: string;
}

export interface PDAccount {
  id?: string;
  name?: string;
  subdomain?: string;
}

/** GET /users/me only resolves an identity for a user-level token; an
 *  account-level (general access) token has no "current user" and must be
 *  validated a different way. */
export interface PDConnectionInfo {
  tokenType: "user" | "account";
  user: PDUser | null;
}

export interface PDWebhookSubscription {
  id: string;
  type: string;
  description?: string;
  delivery_method: {
    type: string;
    url?: string;
  };
  filter?: {
    id: string;
    type: string;
  };
}

export interface PDListResponse<T> {
  [key: string]: T[] | number | boolean | undefined;
  limit?: number;
  offset?: number;
  more?: boolean;
  total?: number;
}
