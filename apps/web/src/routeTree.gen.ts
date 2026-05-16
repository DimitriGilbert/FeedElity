import { Route as rootRouteImport } from './routes/__root'
import { Route as LoginRouteImport } from './routes/login'
import { Route as DashboardRouteImport } from './routes/dashboard'
import { Route as IndexRouteImport } from './routes/index'

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
const DashboardRouteOptions: NonNullable<Parameters<typeof DashboardRouteImport.update>[0]> & {
  id: string
  path: string
  getParentRoute: () => typeof rootRouteImport
} = {
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => rootRouteImport,
}
const DashboardRoute = DashboardRouteImport.update(DashboardRouteOptions)
const IndexRouteOptions: NonNullable<Parameters<typeof IndexRouteImport.update>[0]> & {
  id: string
  path: string
  getParentRoute: () => typeof rootRouteImport
} = {
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
}
const IndexRoute = IndexRouteImport.update(IndexRouteOptions)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/dashboard': typeof DashboardRoute
  '/login': typeof LoginRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/dashboard': typeof DashboardRoute
  '/login': typeof LoginRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/dashboard': typeof DashboardRoute
  '/login': typeof LoginRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/dashboard' | '/login'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/dashboard' | '/login'
  id: '__root__' | '/' | '/dashboard' | '/login'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  DashboardRoute: typeof DashboardRoute
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
    '/dashboard': {
      id: '/dashboard'
      path: '/dashboard'
      fullPath: '/dashboard'
      preLoaderRoute: typeof DashboardRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  DashboardRoute: DashboardRoute,
  LoginRoute: LoginRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
