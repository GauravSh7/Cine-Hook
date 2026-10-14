import type { ReactNode } from 'react'

export function AdminTable({ headings, children }: { headings: string[]; children: ReactNode }) {
  return <div className="panel table-scroll" tabIndex={0} aria-label="Scrollable data table"><table className="admin-table">
    <thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody>
  </table></div>
}
