/**
 * Canonical Project Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 1 — Core Backend & Coordinator
 */

export const PROJECT_CONTRACT_VERSION = "1.0.0";

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreateRequest {
  id?: string;
  name: string;
  description?: string;
}
