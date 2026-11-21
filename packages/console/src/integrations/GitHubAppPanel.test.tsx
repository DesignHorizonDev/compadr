import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubAppState } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { GitHubAppPanel } from './GitHubAppPanel.tsx'

afterEach(cleanup)

const WAITING: GitHubAppState = {
  organization: 'acme',
  registered: false,
  slug: null,
  htmlUrl: null,
  installUrl: null,
  installation: null,
  problem: null,
  repositories: [
    {
      id: 'app',
      github: 'acme/app',
      served: false,
      error: 'the GitHub App is not registered yet',
    },
  ],
}

describe('GitHubAppPanel', () => {
  it('posts the manifest to GitHub', async () => {
    const user = userEvent.setup()
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => {})
    const { container } = render(
      <GitHubAppPanel
        portal={fakePortal({
          githubApp: () => Promise.resolve(WAITING),
          startGithubApp: () =>
            Promise.resolve({
              action:
                'https://github.test/organizations/acme/settings/apps/new?state=s',
              manifest: '{"name":"Compadr acme"}',
            }),
        })}
      />
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Create the GitHub App on GitHub',
      })
    )
    await vi.waitFor(() => expect(submit).toHaveBeenCalled())
    const form = container.querySelector('form')!
    expect(form.getAttribute('action')).toBe(
      'https://github.test/organizations/acme/settings/apps/new?state=s'
    )
    expect(form.getAttribute('method')).toBe('post')
    expect(
      (form.querySelector('input[name=manifest]') as HTMLInputElement).value
    ).toBe('{"name":"Compadr acme"}')
    submit.mockRestore()
  })

  it('links to the installation and lists the waiting repositories', async () => {
    render(
      <GitHubAppPanel
        portal={fakePortal({
          githubApp: () =>
            Promise.resolve({
              ...WAITING,
              registered: true,
              slug: 'compadr-acme',
              htmlUrl: 'https://github.test/apps/compadr-acme',
              installUrl:
                'https://github.test/apps/compadr-acme/installations/new',
              repositories: [
                {
                  id: 'app',
                  github: 'acme/app',
                  served: false,
                  error: 'not installed',
                },
              ],
            }),
        })}
      />
    )
    expect(
      (
        await screen.findByRole('link', { name: 'Install the app on acme' })
      ).getAttribute('href')
    ).toBe('https://github.test/apps/compadr-acme/installations/new')
    const list = within(
      screen.getByRole('list', { name: 'Repositories of the GitHub App' })
    )
    expect(list.getByRole('listitem').textContent).toBe(
      'acme/app · not served yet: not installed'
    )
    expect(
      screen.getByText(/Restart the portal once the app is installed/)
    ).toBeTruthy()
  })
})
