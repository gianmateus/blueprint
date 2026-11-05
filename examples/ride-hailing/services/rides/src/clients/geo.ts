import { httpJson } from '@ride/shared';
export const driversNear = (lat: number, lng: number) => httpJson<{ id: string; lat: number; lng: number }[]>(`${process.env.GEO_URL}/locate?lat=${lat}&lng=${lng}`);
