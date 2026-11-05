import { httpJson } from '@ride/shared';
export const getRider = (id: string) => httpJson(`${process.env.USERS_URL}/users/${id}`);
