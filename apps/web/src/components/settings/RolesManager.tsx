import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as roleService from '../../services/roleService';
import type { RoleWithPermissions } from '@shared/auth';
import { PAGE_PERMISSIONS, SETTINGS_PERMISSIONS } from '@shared/auth';
import styles from './RolesManager.module.css';

interface RolesManagerProps {
  onUpdate?: () => void;
}

export function RolesManager({ onUpdate }: RolesManagerProps) {
  const { t } = useTranslation('settings');
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPermissions, setFormPermissions] = useState<Set<string>>(new Set());

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await roleService.listRoles();
      setRoles(data);
    } catch (e) {
      console.error('Failed to load roles:', e);
      setError(e instanceof Error ? e.message : t('role_error_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingRole(null);
    setFormName('');
    setFormPermissions(new Set());
  };

  const handleEdit = (role: RoleWithPermissions) => {
    setIsCreating(false);
    setEditingRole(role);
    setFormName(role.name);
    setFormPermissions(new Set(role.permissions));
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingRole(null);
    setFormName('');
    setFormPermissions(new Set());
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      alert(t('role_error_name'));
      return;
    }

    try {
      const permissions = Array.from(formPermissions);
      
      if (editingRole) {
        // Update existing role
        await roleService.updateRole({
          id: editingRole.id,
          name: formName,
          permissions,
        });
      } else {
        // Create new role
        await roleService.createRole({
          name: formName,
          permissions,
        });
      }

      await loadRoles();
      handleCancel();
      onUpdate?.();
    } catch (e) {
      console.error('Failed to save role:', e);
      alert(e instanceof Error ? e.message : t('role_error_save'));
    }
  };

  const handleDelete = async (roleId: string, roleName: string) => {
    if (!confirm(t('role_confirm_delete', { name: roleName }))) {
      return;
    }

    try {
      await roleService.deleteRole(roleId);
      await loadRoles();
      onUpdate?.();
    } catch (e) {
      console.error('Failed to delete role:', e);
      alert(e instanceof Error ? e.message : t('role_error_delete'));
    }
  };

  const togglePermission = (key: string) => {
    const newPerms = new Set(formPermissions);
    if (newPerms.has(key)) {
      newPerms.delete(key);
    } else {
      newPerms.add(key);
    }
    setFormPermissions(newPerms);
  };

  if (loading) {
    return <div className={styles.loading}>{t('role_loading')}</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button className="btn-primary" onClick={loadRoles}>
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rolesManager}>
      {/* Role List */}
      {!isCreating && !editingRole && (
        <div className={styles.rolesList}>
          <div className={styles.rolesHeader}>
            <h3>{t('role_custom')}</h3>
            <button className="btn-primary" onClick={handleCreate}>
              {t('role_create_new')}
            </button>
          </div>

          {roles.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t('role_empty')}</p>
              <p className={styles.emptyStateHint}>
                {t('role_empty_hint')}
              </p>
            </div>
          ) : (
            <div className={styles.rolesGrid}>
              {roles.map((role) => (
                <div key={role.id} className={styles.roleCard}>
                  <div className={styles.roleCardHeader}>
                    <h4 className={styles.roleName}>{role.name}</h4>
                    <div className={styles.roleActions}>
                      <button
                        className={styles.roleActionButton}
                        onClick={() => handleEdit(role)}
                        title={t('edit')}
                      >
                        ✏️
                      </button>
                      <button
                        className={styles.roleActionButton}
                        onClick={() => handleDelete(role.id, role.name)}
                        title={t('delete_action')}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className={styles.rolePermissions}>
                    <span className={styles.permissionCount}>
                      {role.permissions.length} {t('role_permissions_count')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Role Editor */}
      {(isCreating || editingRole) && (
        <div className={styles.roleEditor}>
          <div className={styles.editorHeader}>
            <h3>{isCreating ? t('role_new') : t('role_edit', { name: editingRole?.name })}</h3>
            <button className={styles.closeButton} onClick={handleCancel}>
              ×
            </button>
          </div>

          <div className={styles.editorContent}>
            {/* Role Name */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t('role_name')}</label>
              <input
                type="text"
                className={styles.formInput}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('role_name_placeholder')}
                autoFocus
              />
            </div>

            {/* Page Permissions */}
            <div className={styles.formGroup}>
              <h4 className={styles.permissionSectionTitle}>{t('role_page_access')}</h4>
              <div className={styles.permissionGrid}>
                {PAGE_PERMISSIONS.map((perm) => (
                  <label key={perm.key} className={styles.permissionCheckbox}>
                    <input
                      type="checkbox"
                      checked={formPermissions.has(perm.key)}
                      onChange={() => togglePermission(perm.key)}
                    />
                    <span>{t(perm.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Settings Permissions */}
            <div className={styles.formGroup}>
              <h4 className={styles.permissionSectionTitle}>{t('role_settings_access')}</h4>
              <div className={styles.permissionGrid}>
                {SETTINGS_PERMISSIONS.map((perm) => (
                  <label key={perm.key} className={styles.permissionCheckbox}>
                    <input
                      type="checkbox"
                      checked={formPermissions.has(perm.key)}
                      onChange={() => togglePermission(perm.key)}
                    />
                    <span>{t(perm.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className={styles.editorActions}>
              <button className="btn-secondary" onClick={handleCancel}>
                {t('common:cancel')}
              </button>
              <button className="btn-primary" onClick={handleSave}>
                {isCreating ? t('role_create') : t('common:save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
