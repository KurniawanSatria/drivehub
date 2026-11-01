import { maskEmail } from './format';

export type Account = {
  id: string;
  label: string;
  createdAt: number;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
};

/** account tanpa kredensial + email-nya disamarin, aman dikirim ke browser */
export type AccountView = Pick<Account, 'id' | 'label' | 'createdAt'>;

export function toAccountView(account: Account): AccountView {
  const { id, label, createdAt } = account;
  return { id, label: maskEmail(label), createdAt };
}

export type RemoteFile = {
  id: string;
  name: string;
  size: number | null;
  modifiedAt: string | null;
  mimeType: string | null;
  /** ada gambar preview yang bisa diambil dari /api/thumb */
  thumbnail: boolean;
  /** link file di web google drive, buat menu "open in google drive" */
  webViewLink: string | null;
  accountId: string;
  accountLabel: string;
};
