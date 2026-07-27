import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M3 7.5h7l2-2h9v13H3z" /><path d="M3 9h18" /></Icon>;
export const SaveIcon = (props: IconProps) => <Icon {...props}><path d="M5 3h12l3 3v15H4V3z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></Icon>;
export const SearchIcon = (props: IconProps) => <Icon {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></Icon>;
export const UndoIcon = (props: IconProps) => <Icon {...props}><path d="m9 8-5 4 5 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></Icon>;
export const RedoIcon = (props: IconProps) => <Icon {...props}><path d="m15 8 5 4-5 4" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></Icon>;
export const RotateIcon = (props: IconProps) => <Icon {...props}><path d="M20 8V3l-2 2a9 9 0 1 0 2.2 9" /><path d="M20 3h-5" /></Icon>;
export const CommentIcon = (props: IconProps) => <Icon {...props}><path d="M4 4h16v12H9l-5 4z" /></Icon>;
export const PanelIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></Icon>;
export const HandIcon = (props: IconProps) => <Icon {...props}><path d="M8 11V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v5c0 4-3 7-7 7h-1c-3 0-5-2-6-4l-2-4a1.5 1.5 0 0 1 3-1z" /></Icon>;
export const SelectIcon = (props: IconProps) => <Icon {...props}><path d="m5 3 13 10-7 1-3 6z" /></Icon>;
export const NoteIcon = (props: IconProps) => <Icon {...props}><path d="M5 3h14v13l-5 5H5z" /><path d="M14 21v-5h5M8 7h8M8 11h6" /></Icon>;
export const MoonIcon = (props: IconProps) => <Icon {...props}><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z" /></Icon>;
export const SunIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
