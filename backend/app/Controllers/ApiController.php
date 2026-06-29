<?php

namespace App\Controllers;

use App\Libraries\TenantManager;
use App\Models\ActivityLogModel;
use CodeIgniter\API\ResponseTrait;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\Session\Session;
use Psr\Log\LoggerInterface;

/**
 * Base controller for all JSON API endpoints.
 *
 * Provides:
 *  - ResponseTrait helpers (respond, fail, failValidationErrors, ...)
 *  - input(): reads a value from a JSON body OR a classic form post
 *  - the session service
 */
abstract class ApiController extends BaseController
{
    use ResponseTrait;

    protected Session $session;

    public function initController(RequestInterface $request, ResponseInterface $response, LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->session = service('session');
    }

    /**
     * Reads request input regardless of content type. The frontend sends a JSON
     * body (Content-Type: application/json), which getPost() would not parse.
     *
     * @return mixed
     */
    protected function input(?string $key = null, $default = null)
    {
        $isJson = str_contains((string) $this->request->getHeaderLine('Content-Type'), 'application/json');

        if ($isJson) {
            $body = $this->request->getJSON(true) ?? [];

            return $key === null ? $body : ($body[$key] ?? $default);
        }

        if ($key === null) {
            return $this->request->getPost() ?? [];
        }

        return $this->request->getPost($key) ?? $default;
    }

    /**
     * The authenticated user stored in the session, or null.
     */
    protected function currentUser(): ?array
    {
        return $this->session->get('user');
    }

    /**
     * Append an entry to the audit log, attributed to the current session user
     * (or an anonymous "public" actor when unauthenticated). Logging must never
     * break the action it records, so any failure is swallowed and logged.
     *
     * @param string      $action      e.g. 'created' | 'updated' | 'deleted' | 'login'
     * @param string|null $entityType  e.g. 'client' | 'demo_request' | 'event'
     * @param int|null    $entityId    primary key of the affected row, if any
     * @param string|null $description human-readable summary, shown in the UI
     * @param int|null    $clientId    tenant scope (defaults to the actor's own)
     */
    protected function logActivity(
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        ?string $description = null,
        ?int $clientId = null
    ): void {
        try {
            $user  = $this->currentUser();
            $role  = $user['role'] ?? 'public';
            $scope = $clientId ?? ($user['client_id'] ?? null);
            $this->activityLogModel($role, $scope)->insert([
                'actor_id'    => $user['id'] ?? null,
                'actor_role'  => $role,
                'actor_name'  => $user['name'] ?? ($user['email'] ?? null),
                'action'      => $action,
                'entity_type' => $entityType,
                'entity_id'   => $entityId,
                'description' => $description !== null ? mb_substr($description, 0, 255) : null,
                'client_id'   => $scope,
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Activity log write failed: ' . $e->getMessage());
        }
    }

    /**
     * Pick the right audit-log store. Super-admin and platform-level (no client)
     * activity lives in the main DB; a client_admin's or staff member's activity
     * lives in that client's own database — true tenant isolation. Falls back to
     * the main DB if the tenant connection can't be resolved.
     */
    protected function activityLogModel(?string $role, ?int $clientId): ActivityLogModel
    {
        if ($role === 'super_admin' || $clientId === null) {
            return new ActivityLogModel();
        }

        try {
            return new ActivityLogModel((new TenantManager())->forClient($clientId));
        } catch (\Throwable $e) {
            log_message('error', 'Tenant activity store unavailable, using main DB: ' . $e->getMessage());

            return new ActivityLogModel();
        }
    }
}
