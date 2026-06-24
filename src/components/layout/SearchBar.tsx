import React, { useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/drive/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleClear = () => {
    setQuery("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`relative flex items-center w-full max-w-2xl h-12 transition-all duration-200 rounded-full px-4 ${
        isFocused
          ? "bg-background shadow-md border border-slate-200 dark:border-slate-800"
          : "bg-slate-100 dark:bg-slate-900 border border-transparent"
      }`}
    >
      <Search className="h-5 w-5 text-muted-foreground mr-3 shrink-0" />
      
      <Input
        type="text"
        placeholder="Search in TeleDrive"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="w-full h-full bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 text-sm"
      />

      {query && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="h-8 w-8 rounded-full hover:bg-muted shrink-0 ml-1"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </form>
  );
}
