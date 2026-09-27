import { type InputHTMLAttributes, useState } from "react";
import { useTranslation } from "react-i18next";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, className = "", type, ...props }: TextFieldProps) {
  if (type === "password") return <PasswordField label={label} id={id} className={className} {...props} />;
  return <label className="grid gap-2 font-medium" htmlFor={id}>
    {label}
    <input
      id={id}
      type={type}
      className={`form-control rounded-lg border px-3 py-3 ${className}`}
      {...props}
    />
  </label>;
}

function PasswordField({ label, id, className = "", ...props }: Omit<TextFieldProps, "type">) {
  const { t } = useTranslation();
  const [isVisible, setVisible] = useState(false);
  return <div className="grid gap-2">
    <label className="font-medium" htmlFor={id}>{label}</label>
    <div className="relative">
      <input
        id={id}
        type={isVisible ? "text" : "password"}
        className={`form-control w-full rounded-lg border py-3 pr-12 pl-3 ${className}`}
        {...props}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
      />
      <button
        type="button"
        data-testid={`${id}-visibility`}
        aria-label={t("password.show")}
        aria-pressed={isVisible}
        aria-controls={id}
        onClick={() => setVisible((current) => !current)}
        className="focus-ring text-muted absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg hover:text-(--cs-text)"
      ><VisibilityIcon isVisible={isVisible} /></button>
    </div>
  </div>;
}

function VisibilityIcon({ isVisible }: { isVisible: boolean }) {
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="size-5"
  >
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {isVisible && <path d="M3 3l18 18" />}
  </svg>;
}
