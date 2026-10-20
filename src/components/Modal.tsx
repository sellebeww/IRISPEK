"use client";
import { useEffect, useRef, ReactNode } from "react";
export function Modal({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="modal-dialog" aria-label={label}>
      {children}
    </dialog>
  );
}
