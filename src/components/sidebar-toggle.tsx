"use client";
import { useEffect, useState } from "react";

export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed") === "true";
    setCollapsed(stored);
    document.documentElement.classList.toggle("sidebar-collapsed", stored);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
    document.documentElement.classList.toggle("sidebar-collapsed", next);
  }

  return (
    <button
      className="sidebar-toggle-btn"
      onClick={toggle}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? "›" : "‹"}
    </button>
  );
}
