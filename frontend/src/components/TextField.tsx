import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, ...props }: TextFieldProps) {
  return <label className="grid gap-2 font-medium" htmlFor={id}>
    {label}
    <input
      id={id}
      className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-950 outline-none focus:border-(--club-primary) focus:ring-2 focus:ring-(--club-primary)/25"
      {...props}
    />
  </label>;
}
