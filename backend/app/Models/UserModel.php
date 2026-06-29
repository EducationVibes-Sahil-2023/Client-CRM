<?php

namespace App\Models;

/**
 * Users of the platform: super admins (client_id NULL) and per-client admins.
 */
class UserModel extends BaseModel
{
    protected $table         = 'users';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['name', 'avatar', 'email', 'password', 'role', 'client_id'];

    protected $validationRules = [
        'email' => 'required|valid_email|is_unique[users.email,id,{id}]',
        'role'  => 'required|in_list[super_admin,client_admin]',
    ];

    protected $validationMessages = [
        'email' => [
            'is_unique' => 'That email address is already registered.',
        ],
    ];

    /**
     * Hash the password automatically whenever it is set on insert/update,
     * so controllers never deal with hashing and never store plaintext.
     */
    protected $beforeInsert = ['hashPassword'];
    protected $beforeUpdate = ['hashPassword'];

    protected function hashPassword(array $data): array
    {
        if (isset($data['data']['password']) && $data['data']['password'] !== '') {
            $data['data']['password'] = password_hash($data['data']['password'], PASSWORD_DEFAULT);
        }

        return $data;
    }

    public function findByEmail(string $email): ?array
    {
        return $this->where('email', $email)->first();
    }
}
