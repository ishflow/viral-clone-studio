import { isIP } from 'node:net';

const IPV6_GROUPS = 8;
const NETWORK_GROUPS = 4; // a /64

/**
 * The rate-limit bucket of one caller address, or null when the value is not one address (empty, a list, a name).
 * An IPv4 address is its own bucket. An IPv6 caller holds a whole /64 and can change the rest at will, so its bucket is the network.
 */
export function callerBucket(value: string | null | undefined): string | null {
  const address = (value ?? '').trim().toLowerCase();
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  if (address.includes('.')) return address; // an IPv4 written inside an IPv6 has no /64 of its own
  const [head = '', tail] = address.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const groups = [...first, ...Array<string>(IPV6_GROUPS - first.length - last.length).fill('0'), ...last];
  return `${groups.slice(0, NETWORK_GROUPS).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}
