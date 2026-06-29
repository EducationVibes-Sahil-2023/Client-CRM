<?php

namespace App\Controllers;

class Home extends ApiController
{
    /**
     * GET / — API status / index.
     */
    public function index()
    {
        return $this->respond([
            'name'    => 'CRM Multi-Tenant API',
            'status'  => 'ok',
            'version' => '1.0.0',
            'endpoints' => [
                'POST /auth/login',
                'POST /auth/logout',
                'GET  /auth/me',
                'GET  /superadmin/dashboard',
                'POST /superadmin/clients',
                'POST /superadmin/feature-toggle',
                'POST /superadmin/admins',
                'GET  /client/dashboard',
                'GET  /client/settings',
            ],
        ]);
    }
}
