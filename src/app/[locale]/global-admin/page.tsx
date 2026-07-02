import { redirect } from 'next/navigation'

export default function GlobalAdminIndex() {
  redirect('/global-admin/organizations')
}
