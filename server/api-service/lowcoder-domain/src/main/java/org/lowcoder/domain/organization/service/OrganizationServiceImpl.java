package org.lowcoder.domain.organization.service;

import jakarta.annotation.Nonnull;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.lowcoder.domain.asset.model.Asset;
import org.lowcoder.domain.asset.service.AssetRepository;
import org.lowcoder.domain.asset.service.AssetService;
import org.lowcoder.domain.group.service.GroupService;
import org.lowcoder.domain.organization.event.OrgDeletedEvent;
import org.lowcoder.domain.organization.model.*;
import org.lowcoder.domain.organization.model.Organization.OrganizationCommonSettings;
import org.lowcoder.domain.organization.repository.OrganizationRepository;
import org.lowcoder.domain.user.model.User;
import org.lowcoder.infra.annotation.PossibleEmptyMono;
import org.lowcoder.infra.mongo.MongoUpsertHelper;
import org.lowcoder.sdk.config.CommonConfig;
import org.lowcoder.sdk.config.dynamic.Conf;
import org.lowcoder.sdk.config.dynamic.ConfigCenter;
import org.lowcoder.sdk.constants.FieldName;
import org.lowcoder.sdk.constants.WorkspaceMode;
import org.lowcoder.sdk.exception.BizError;
import org.lowcoder.sdk.exception.BizException;
import org.lowcoder.sdk.util.UriUtils;
import org.springframework.context.ApplicationContext;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.codec.multipart.Part;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.Collection;
import java.util.List;
import java.util.Locale;

import static org.lowcoder.domain.authentication.AuthenticationService.DEFAULT_AUTH_CONFIG;
import static org.lowcoder.domain.organization.model.OrganizationState.ACTIVE;
import static org.lowcoder.domain.organization.model.OrganizationState.DELETED;
import static org.lowcoder.domain.util.QueryDslUtils.fieldName;
import static org.lowcoder.sdk.exception.BizError.UNABLE_TO_FIND_VALID_ORG;
import static org.lowcoder.sdk.util.ExceptionUtils.deferredError;
import static org.lowcoder.sdk.util.ExceptionUtils.ofError;
import static org.lowcoder.sdk.util.LocaleUtils.getLocale;
import static org.lowcoder.sdk.util.LocaleUtils.getMessage;

@Slf4j
@RequiredArgsConstructor
@Service
public class OrganizationServiceImpl implements OrganizationService {

    private Conf<Integer> logoMaxSizeInKb;

    private static final String PASSWORD_RESET_EMAIL_TEMPLATE_DEFAULT = "<p>Hi, %s<br/>" +
            "Here is the link to reset your password: %s<br/>" +
            "Please note that the link will expire after 12 hours.<br/><br/>" +
            "Regards,<br/>" +
            "The Lowcoder Team</p>";

    private final AssetRepository assetRepository;
    private final AssetService assetService;
    private final OrgMemberService orgMemberService;
    private final MongoUpsertHelper mongoUpsertHelper;
    private final OrganizationRepository repository;
    private final GroupService groupService;
    private final ApplicationContext applicationContext;
    private final CommonConfig commonConfig;
    private final ConfigCenter configCenter;

    @PostConstruct
    private void init()
    {
        logoMaxSizeInKb = configCenter.asset().ofInteger("logoMaxSizeInKb", 300);
    }

    @Override
    public Mono<Organization> createDefault(User user, boolean isSuperAdmin) {
        return Mono.deferContextual(contextView -> {
            Locale locale = getLocale(contextView);
            String userOrgSuffix = getMessage(locale, "USER_ORG_SUFFIX");

            Organization organization = new Organization();
            organization.setName(user.getName() + userOrgSuffix);
            organization.setIsAutoGeneratedOrganization(true);
            // saas mode
            if (commonConfig.getWorkspace().getMode() == WorkspaceMode.SAAS) {
                return create(organization, user.getId(), isSuperAdmin);
            }
            // enterprise mode
            return joinOrganizationInEnterpriseMode(user.getId())
                    .flatMap(join -> {
                        if (Boolean.TRUE.equals(join)) {
                            return Mono.empty();
                        }
                        OrganizationDomain organizationDomain = new OrganizationDomain();
                        organizationDomain.setConfigs(List.of(DEFAULT_AUTH_CONFIG));
                        organization.setOrganizationDomain(organizationDomain);
                        return create(organization, user.getId(), isSuperAdmin);
                    });
        });
    }

    private Mono<Boolean> joinOrganizationInEnterpriseMode(String userId) {
        return getOrganizationInEnterpriseMode()
                .flatMap(organization -> orgMemberService.addMember(organization.getId(), userId, MemberRole.MEMBER))
                .defaultIfEmpty(false);
    }

    @Override
    @PossibleEmptyMono
    public Mono<Organization> getOrganizationInEnterpriseMode() {
        if (commonConfig.getWorkspace().getMode() == WorkspaceMode.SAAS) {
            return Mono.empty();
        }
        return getByEnterpriseOrgId()
                .switchIfEmpty(repository.findFirstByStateMatches(ACTIVE));
    }

    @Nonnull
    private Mono<Organization> getByEnterpriseOrgId() {
        String enterpriseOrgId = commonConfig.getWorkspace().getEnterpriseOrgId();
        if (StringUtils.isBlank(enterpriseOrgId)) {
            return Mono.empty();
        }
        return repository.findById(enterpriseOrgId)
                .delayUntil(org -> {
                            if (org.getState() == DELETED) {
                                return ofError(BizError.ORG_DELETED_FOR_ENTERPRISE_MODE, "ORG_DELETED_FOR_ENTERPRISE_MODE");
                            }
                            return Mono.empty();
                        }
                );
    }

    @Override
    public Mono<Organization> create(Organization organization, String creatorId, boolean isSuperAdmin) {

        return Mono.defer(() -> {
                    if (organization == null || StringUtils.isNotBlank(organization.getId())) {
                        return Mono.error(new BizException(BizError.INVALID_PARAMETER, "INVALID_PARAMETER", FieldName.ORGANIZATION));
                    }
                    organization.setCommonSettings(new OrganizationCommonSettings());
                    organization.getCommonSettings().put(OrganizationCommonSettings.PASSWORD_RESET_EMAIL_TEMPLATE,
                            PASSWORD_RESET_EMAIL_TEMPLATE_DEFAULT);
                    organization.setState(ACTIVE);
                    return Mono.just(organization);
                })
                .flatMap(repository::save)
                .flatMap(newOrg -> onOrgCreated(creatorId, newOrg, isSuperAdmin))
                .log();
    }

    private Mono<Organization> onOrgCreated(String userId, Organization newOrg, boolean isSuperAdmin) {
        return groupService.createAllUserGroup(newOrg.getId())
                .then(groupService.createDevGroup(newOrg.getId()))
                .then(setOrgAdmin(userId, newOrg, isSuperAdmin))
                .thenReturn(newOrg);
    }

    private Mono<Boolean> setOrgAdmin(String userId, Organization newOrg, boolean isSuperAdmin) {
        return orgMemberService.addMember(newOrg.getId(), userId, isSuperAdmin ? MemberRole.SUPER_ADMIN : MemberRole.ADMIN);
    }

    @Override
    public Mono<Organization> getById(String id) {
        return repository.findByIdAndState(id, ACTIVE)
                .switchIfEmpty(deferredError(UNABLE_TO_FIND_VALID_ORG, "INVALID_ORG_ID"));
    }

    @Override
    public Mono<OrganizationCommonSettings> getOrgCommonSettings(String orgId) {
        return repository.findByIdAndState(orgId, ACTIVE)
                .switchIfEmpty(deferredError(UNABLE_TO_FIND_VALID_ORG, "INVALID_ORG_ID"))
                .map(Organization::getCommonSettings);
    }

    @Override
    public Flux<Organization> getByIds(Collection<String> ids) {
        return repository.findByIdInAndState(ids, ACTIVE);
    }

    @Override
    public Mono<Boolean> uploadLogo(String organizationId, Part filePart) {

        Mono<Asset> uploadAssetMono = assetService.upload(filePart, logoMaxSizeInKb.get(), false);

        return uploadAssetMono
                .flatMap(uploadedAsset -> {
                    Organization organization = new Organization();
                    final String prevAssetId = organization.getLogoAssetId();
                    organization.setLogoAssetId(uploadedAsset.getId());

                    return mongoUpsertHelper.updateById(organization, organizationId)
                            .flatMap(updateResult -> {
                                if (StringUtils.isEmpty(prevAssetId)) {
                                    return Mono.just(updateResult);
                                }
                                return assetService.remove(prevAssetId).thenReturn(updateResult);
                            });
                });
    }

    @Override
    public Mono<Boolean> deleteLogo(String organizationId) {
        return repository.findByIdAndState(organizationId, ACTIVE)
                .flatMap(organization -> {
                    // delete from asset repo.
                    final String prevAssetId = organization.getLogoAssetId();
                    if (StringUtils.isBlank(prevAssetId)) {
                        return Mono.error(new BizException(BizError.NO_RESOURCE_FOUND, "ASSET_NOT_FOUND", ""));
                    }
                    return assetRepository.findById(prevAssetId)
                            .switchIfEmpty(Mono.error(new BizException(BizError.NO_RESOURCE_FOUND, "ASSET_NOT_FOUND", prevAssetId)))
                            .flatMap(asset -> assetRepository.delete(asset));
                })
                .then(Mono.defer(() -> {
                    // update org.
                    Organization organization = new Organization();
                    organization.setLogoAssetId(null);
                    return mongoUpsertHelper.updateById(organization, organizationId);
                }));
    }

    @Override
    public Mono<Boolean> update(String orgId, Organization updateOrg) {
        return mongoUpsertHelper.updateById(updateOrg, orgId);
    }

    @Override
    public Mono<Boolean> delete(String orgId) {
        Organization organization = new Organization();
        organization.setState(OrganizationState.DELETED);
        return mongoUpsertHelper.updateById(organization, orgId)
                .delayUntil(success -> {
                    if (Boolean.TRUE.equals(success)) {
                        return sendOrgDeletedEvent(orgId);
                    }
                    return Mono.empty();
                });
    }

    private Mono<Void> sendOrgDeletedEvent(String orgId) {
        OrgDeletedEvent event = new OrgDeletedEvent();
        event.setOrgId(orgId);
        applicationContext.publishEvent(event);
        return Mono.empty();
    }

    @Override
    public Mono<Organization> getBySourceAndTpCompanyId(String source, String companyId) {
        return repository.findBySourceAndThirdPartyCompanyIdAndState(source, companyId, ACTIVE);
    }

    @Override
    public Mono<Organization> getByDomain() {
        return UriUtils.getRefererDomainFromContext()
                .flatMap(domain -> repository.findByOrganizationDomain_DomainAndState(domain, ACTIVE));
    }

    @Override
    public Mono<Boolean> updateCommonSettings(String orgId, String key, Object value) {
        long updateTime = System.currentTimeMillis();
        Update update = Update.update(fieldName(QOrganization.organization.commonSettings) + "." + key, value)
                .set(fieldName(QOrganization.organization.commonSettings) + "." + buildCommonSettingsUpdateTimeKey(key), updateTime);
        return mongoUpsertHelper.upsert(update, FieldName.ID, orgId, Organization.class);
    }

    private String buildCommonSettingsUpdateTimeKey(String key) {
        return key + "_updateTime";
    }
}
