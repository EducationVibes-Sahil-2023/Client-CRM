<?php

namespace App\Controllers;

use App\Models\ContactMessageModel;
use App\Models\DemoRequestModel;
use App\Models\LandingSettingModel;

/**
 * Public (unauthenticated) endpoints for the marketing site:
 *  - GET  /landing       — landing-page content (logo, pricing, testimonials)
 *  - POST /contact       — "Contact us" form
 *  - POST /demo-request  — "Request a demo" form
 *
 * These are intentionally open (no auth filter) so anonymous visitors can
 * submit. They write to the shared crm_main database for the super admin
 * to review.
 */
class PublicController extends ApiController
{
    /**
     * GET /landing — public landing-page content, managed by the super admin.
     */
    public function landing()
    {
        return $this->respond((new LandingSettingModel())->getContent());
    }

    /**
     * POST /contact
     * Body: { name, email, company?, message }
     */
    public function contact()
    {
        $model = new ContactMessageModel();

        $data = [
            'name'    => trim((string) $this->input('name')),
            'email'   => trim((string) $this->input('email')),
            'company' => trim((string) $this->input('company', '')),
            'message' => trim((string) $this->input('message')),
            'status'  => 'new',
        ];

        $id = $model->insert($data);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }

        $this->logActivity('created', 'contact_message', (int) $id, 'New contact message from ' . $data['name']);

        return $this->respondCreated([
            'message' => 'Thanks for reaching out! We will get back to you shortly.',
            'id'      => $id,
        ]);
    }

    /**
     * POST /demo-request
     * Body: { name, email, company, phone?, teamSize?, interest?, message? }
     */
    public function demoRequest()
    {
        $model = new DemoRequestModel();

        $data = [
            'name'      => trim((string) $this->input('name')),
            'email'     => trim((string) $this->input('email')),
            'company'   => trim((string) $this->input('company')),
            'phone'     => trim((string) $this->input('phone', '')),
            // The frontend sends camelCase "teamSize"; accept both spellings.
            'team_size' => trim((string) ($this->input('teamSize') ?? $this->input('team_size', ''))),
            'interest'  => trim((string) $this->input('interest', '')),
            'message'   => trim((string) $this->input('message', '')),
            'status'    => 'new',
        ];

        $id = $model->insert($data);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }

        $this->logActivity('created', 'demo_request', (int) $id, 'New demo request from ' . $data['name']);

        return $this->respondCreated([
            'message' => 'Your demo request is in! A specialist will reach out within one business day.',
            'id'      => $id,
        ]);
    }
}
