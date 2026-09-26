import { redirect } from "next/navigation";

export default function IndexPage(): never {
  redirect("/overview");
}
