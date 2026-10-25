import { type InputHTMLAttributes, type MouseEvent, type Ref, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";

interface FileInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id" | "className"> {
  id: string;
  "data-testid": string;
  file: File | undefined;
  ref?: Ref<HTMLInputElement | null>;
}

// The browser labels a native file input in its own language, so the input stays for keyboard,
// assistive technology and tests while the visible trigger and status come from the application.
export function FileInput({ id, "data-testid": testId, file, ref, ...props }: FileInputProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(ref, () => input.current, []);
  const status = `${id}-status`;

  function choose(event: MouseEvent) {
    event.preventDefault();
    input.current?.click();
  }

  return <span className="file-input relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <input ref={input} id={id} data-testid={testId} type="file" className="sr-only"
           aria-describedby={status} {...props} />
    <span data-testid={`${testId}-trigger`} aria-hidden="true" onClick={choose} className="file-input-trigger">
      {t("field.chooseFile")}
    </span>
    <span id={status} data-testid={`${testId}-status`} aria-hidden="true" className="text-muted min-w-0 break-all text-sm font-normal">
      {file?.name ?? t("field.noFileChosen")}
    </span>
  </span>;
}
