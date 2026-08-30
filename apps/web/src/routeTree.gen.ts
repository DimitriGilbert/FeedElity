import { Route as rootRouteImport } from './routes/__root'
import { Route as LoginRouteImport } from './routes/login'
import { Route as ShellRouteImport } from './routes/_shell'
import { Route as ShellIndexRouteImport } from './routes/_shell.index'
import { Route as ShellDashboardRouteImport } from './routes/_shell.dashboard'

const LoginRouteOptions: NonNullable<Parameters<typeof LoginRouteImport.update>[0]> & {
  id: string
  path: string
  getParentRoute: () => typeof rootRouteImport
} = {
  id: '/login',
  path: '/login',
  getParentRoute: () => rootRouteImport,
}
const LoginRoute = LoginRouteImport.update(LoginRouteOptions)
const ShellRouteOptions: NonNullable<Parameters<typeof ShellRouteImport.update>[0]> & {
  id: string
  getParentRoute: () => typeof rootRouteImport
} = {
  id: '/_shell',
  getParentRoute: () => rootRouteImport,
}
const ShellRoute = ShellRouteImport.update(ShellRouteOptions)
const ShellIndexRouteOptions: NonNullable<Parameters<typeof ShellIndexRouteImport.update>[0]> & {
  id: string
  path: string
  getParentRoute: () => typeof ShellRoute
} = {
  id: '/',
  path: '/',
  getParentRoute: () => ShellRoute,
}
const ShellIndexRoute = ShellIndexRouteImport.update(ShellIndexRouteOptions)
const ShellDashboardRouteOptions: NonNullable<Parameters<typeof ShellDashboardRouteImport.update>[0]> & {
  id: string
  path: string
  getParentRoute: () => typeof ShellRoute
} = {
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => ShellRoute,
}
const ShellDashboardRoute = ShellDashboardRouteImport.update(ShellDashboardRouteOptions)

export interface FileRoutesByFullPath {
  '/': typeof ShellIndexRoute
  '/login': typeof LoginRoute
  '/dashboard': typeof ShellDashboardRoute
}
export interface FileRoutesByTo {
  '/login': typeof LoginRoute
  '/dashboard': typeof ShellDashboardRoute
  '/': typeof ShellIndexRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/_shell': typeof ShellRouteWithChildren
  '/login': typeof LoginRoute
  '/_shell/dashboard': typeof ShellDashboardRoute
  '/_shell/': typeof ShellIndexRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/login' | '/dashboard'
  fileRoutesByTo: FileRoutesByTo
  to: '/login' | '/dashboard' | '/'
  id: '__root__' | '/_shell' | '/login' | '/_shell/dashboard' | '/_shell/'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  ShellRoute: typeof ShellRouteWithChildren
  LoginRoute: typeof LoginRoute
}

declare module '@tanstack/solid-router' {
  interface FileRoutesByPath {
    '/login': {
      id: '/login'
      path: '/login'
      fullPath: '/login'
      preLoaderRoute: typeof LoginRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/_shell': {
      id: '/_shell'
      path: ''
      fullPath: '/'
      preLoaderRoute: typeof ShellRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/_shell/': {
      id: '/_shell/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof ShellIndexRouteImport
      parentRoute: typeof ShellRoute
    }
    '/_shell/dashboard': {
      id: '/_shell/dashboard'
      path: '/dashboard'
      fullPath: '/dashboard'
      preLoaderRoute: typeof ShellDashboardRouteImport
      parentRoute: typeof ShellRoute
    }
  }
}

interface ShellRouteChildren {
  ShellDashboardRoute: typeof ShellDashboardRoute
  ShellIndexRoute: typeof ShellIndexRoute
}

const ShellRouteChildren: ShellRouteChildren = {
  ShellDashboardRoute: ShellDashboardRoute,
  ShellIndexRoute: ShellIndexRoute,
}

const ShellRouteWithChildren = ShellRoute._addFileChildren(ShellRouteChildren)

const rootRouteChildren: RootRouteChildren = {
  ShellRoute: ShellRouteWithChildren,
  LoginRoute: LoginRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
