'use server';

import { redirect } from 'next/navigation';
import { refreshShell } from './refresh';
import { endSession } from './session';

export async function logOut(): Promise<void> {
  await endSession();
  refreshShell();
  redirect('/');
}
