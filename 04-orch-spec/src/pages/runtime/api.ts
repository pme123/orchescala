import { accessToken, reauthenticate } from './auth';
import { ApiError, type Gateway } from './gatewayTypes';

export { ApiError, type Gateway };

/** POST an den Gateway – öffentlich ohne Token, sonst mit dem Token des Benutzers. */
export async function post(path: string, body: unknown, isPublic: boolean): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isPublic) headers.Authorization = `Bearer ${await accessToken()}`;
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  if (response.status === 401 && !isPublic) return reauthenticate();
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.errorMsg ?? json.message ?? text;
    } catch {
      // kein JSON
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const q = (businessKey?: string) => (businessKey ? `?businessKey=${encodeURIComponent(businessKey)}` : '');
const seg = encodeURIComponent;

export const gateway: Gateway = {
  call: (service: string, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/worker/${seg(service)}`, input, isPublic),
  start: (process: string, businessKey: string | undefined, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/process/${seg(process)}/async${q(businessKey)}`, input, isPublic),
  message: (name: string, businessKey: string, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/message/${seg(name)}${q(businessKey)}`, input, isPublic),
  completeTask: (taskKey: string, taskId: string, input: unknown) =>
    post(`/userTask/${seg(taskKey)}/${seg(taskId)}/complete`, input, false),
};
