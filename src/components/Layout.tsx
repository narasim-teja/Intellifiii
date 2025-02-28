import React from 'react';
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden opacity-10 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-600 blur-3xl"></div>
        <div className="absolute top-1/3 -left-20 w-60 h-60 rounded-full bg-purple-600 blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-72 h-72 rounded-full bg-blue-600 blur-3xl"></div>
      </div>
      
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-md border-b border-gray-700/50">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex h-20 items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center">
              <img
                className="h-14 w-auto"
                src="/logo.png"
                alt="Intellifi"
              />
              <span className="ml-3 text-2xl font-extrabold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight">
                IntelliFi
              </span>
            </div>
            <div className="flex items-center">
              <DynamicWidget />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="w-full pt-20 relative z-10">
        {children}
      </main>
    </div>
  )
} 