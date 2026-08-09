import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cn } from "../../lib/utils"
import { X } from "lucide-react"

const ToastProvider = ToastPrimitive.Provider

export type ToastMessage = {
  title: string
  description: string
  variant: ToastVariant
}

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  // Deliberately in normal flow, not `fixed`. The overlay's window is sized
  // from its content, so a fixed-position toast contributes nothing to
  // scrollHeight and can only ever be drawn *over* the panels or clipped off
  // at the transparent window edge — which is why the Root below used to pin
  // itself to top-4 left-4, straight on top of the control bar. In flow, the
  // window simply grows to make room. `empty:hidden` keeps the padding from
  // costing height when there is no toast.
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "flex w-full flex-col gap-2 bg-transparent px-3 pt-1 outline-none empty:hidden",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

type ToastVariant = "neutral" | "success" | "error"

interface ToastProps extends React.ComponentPropsWithoutRef<
  typeof ToastPrimitive.Root
> {
  variant?: ToastVariant
}

// Semantics live in a 3px left border rather than a saturated fill: quieter
// against the rest of the glass, and readable without relying on hue alone.
const toastVariants: Record<ToastVariant, string> = {
  neutral: "glass-toast glass-toast-neutral",
  success: "glass-toast glass-toast-success",
  error: "glass-toast glass-toast-error"
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  ToastProps
>(({ className, variant = "neutral", ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    // The enter/exit animation lives in index.css, keyed off Radix's
    // data-state. The `animate-in fade-in slide-in-from-bottom` that used to
    // sit here came from tailwindcss-animate, which this project has never
    // depended on — two of those three classes emitted nothing at all.
    className={cn(
      "hit-region group relative w-auto max-w-sm py-2.5 pl-4 pr-9",
      toastVariants[variant],
      className
    )}
    {...props}
  />
))
Toast.displayName = ToastPrimitive.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "text-body font-medium text-glass-heading hover:opacity-90",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitive.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    aria-label="Dismiss"
    className={cn(
      "absolute top-2 right-2 rounded-inner p-1 glass-icon hover:bg-glass-hover hover:text-glass-heading",
      className
    )}
    {...props}
  >
    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("font-semibold text-title", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-body opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

export type { ToastProps, ToastVariant }
export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastAction,
  ToastClose,
  ToastTitle,
  ToastDescription
}
