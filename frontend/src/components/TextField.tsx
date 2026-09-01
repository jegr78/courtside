import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, className = "", ...props }: TextFieldProps) {
  return <label className="grid gap-2 font-medium" htmlFor={id}>
    {label}
    <input
      id={id}
      className={`form-control rounded-lg border px-3 py-3 outline-none ${className}`}
      {...props}
    />
  </label>;
}
