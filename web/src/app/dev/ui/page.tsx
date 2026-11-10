import { devOnly } from '../dev-only';
import { Demo } from './Demo';

export const metadata = { title: 'UI kit' };

export default function DevUiPage() {
  devOnly();
  return <Demo />;
}
