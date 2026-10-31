import AttendanceDashboard from "./AttendanceDashboard";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <AttendanceDashboard schoolName={process.env.SCHOOL_NAME || "Grace House School"} />;
}
